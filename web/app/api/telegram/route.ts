import { defaults, handleCommand, rateLimit, safeEqual, type Subscriber } from "@/lib/telegram";
import type { Snapshot } from "@/lib/types";

const MAX_BODY = 64 * 1024;
const ok = () => new Response(null, { status: 200 });

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    async get(chatId: number): Promise<Subscriber | null> {
      const r = await fetch(`${url}/rest/v1/subscribers?chat_id=eq.${chatId}&select=*`, { headers, cache: "no-store" });
      if (!r.ok) throw new Error(`subscribers ${r.status}`);
      const rows = (await r.json()) as Subscriber[];
      return rows[0] ?? null;
    },
    async save(row: Subscriber): Promise<void> {
      const r = await fetch(`${url}/rest/v1/subscribers?on_conflict=chat_id`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`subscribers save ${r.status}`);
    },
    async snapshot(): Promise<Snapshot | null> {
      const r = await fetch(`${url}/rest/v1/site_snapshot?select=payload&id=eq.1`, { headers, cache: "no-store" });
      if (!r.ok) return null;
      const rows = (await r.json()) as { payload: Snapshot }[];
      return rows[0]?.payload ?? null;
    },
  };
}

async function readCapped(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return raw;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    raw += decoder.decode(value, { stream: true });
  }
}

/** Telegram webhook. Only Telegram knows the secret header; the reply rides back in the response body. */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("not configured", { status: 503 });
  if (!safeEqual((req.headers.get("x-telegram-bot-api-secret-token") ?? "").trim(), secret)) {
    return new Response("forbidden", { status: 403 });
  }
  const store = db();
  if (!store) return new Response("not configured", { status: 503 });

  const raw = await readCapped(req);
  if (raw === null) return ok(); // oversized: drop it, but don't make Telegram retry
  let update: { message?: { chat?: { id?: number; type?: string }; text?: string } };
  try {
    update = JSON.parse(raw);
  } catch {
    return ok();
  }
  const msg = update.message;
  const chatId = msg?.chat?.id;
  // private chats only: no groups or channels, and only text messages
  if (!msg || msg.chat?.type !== "private" || typeof chatId !== "number" || typeof msg.text !== "string") return ok();
  const text = msg.text.slice(0, 200);

  try {
    const now = Date.now();
    const existing = await store.get(chatId);
    const sub = existing ?? defaults(chatId);
    const [allowed, counters] = rateLimit(sub, now);
    if (!allowed) {
      if (existing) await store.save({ ...sub, ...counters });
      return ok(); // flooding: stay silent
    }
    // a stranger chatting without /start isn't subscribed; only /start creates an active row
    const isStart = /^\/start(@\w+)?\b/i.test(text.trim());
    const base: Subscriber = existing ?? { ...sub, active: isStart };
    const [reply, changes] = await handleCommand(text.startsWith("/") ? text : "/help", base, {
      snapshot: store.snapshot,
      site: process.env.RADAR_SITE_URL ?? "https://pr-radar-nikhil.vercel.app",
    });
    // nothing is stored for someone who never sent /start
    if (existing || isStart) {
      await store.save({ ...base, ...changes, ...counters, updated_at: new Date(now).toISOString() });
    }
    return Response.json({
      method: "sendMessage",
      chat_id: chatId,
      text: reply,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    console.error("telegram webhook failed", e instanceof Error ? e.message : e);
    return ok(); // never make Telegram retry-loop on our errors
  }
}
