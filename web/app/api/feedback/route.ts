import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ACTIONS = new Set(["working", "opened_pr", "merged", "ignored", "hidden", "cleared"]);
const TARGET = /^(issue:\d{1,20}|repo:[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100})$/;
const MAX_BODY = 1024;
const LOCAL_FILE = path.join(process.cwd(), "data", "feedback.local.json");
const NO_STORE = { "Cache-Control": "no-store" };

/** Reads and writes need the owner's key. Deployed without FEEDBACK_KEY, everything is refused (fail closed). */
function authorized(req: Request): boolean {
  const expected = process.env.FEEDBACK_KEY?.trim();
  if (!expected) return !process.env.VERCEL; // local dev only
  const given = (req.headers.get("x-radar-key") ?? "").trim();
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

const denied = () => Response.json({ error: "feedback is saved on this device only" }, { status: 401, headers: NO_STORE });

/** The owner's feedback history (private; never part of the public page payload). */
export async function GET(req: Request) {
  if (!authorized(req)) return denied();
  const db = supabase();
  if (db) {
    const r = await fetch(`${db.url}/rest/v1/feedback?select=target_id,action,at&order=at.desc&limit=1000`, {
      headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
      cache: "no-store",
    });
    if (!r.ok) return Response.json({ error: "store failed" }, { status: 502, headers: NO_STORE });
    return Response.json(await r.json(), { headers: NO_STORE });
  }
  try {
    return Response.json(JSON.parse(await readFile(LOCAL_FILE, "utf8")), { headers: NO_STORE });
  } catch {
    return Response.json([], { headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return denied();
  // Read at most MAX_BODY bytes no matter what content-length claims (chunked uploads can omit it).
  const reader = req.body?.getReader();
  let raw = "";
  if (reader) {
    const decoder = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return Response.json({ error: "too large" }, { status: 413 });
      }
      raw += decoder.decode(value, { stream: true });
    }
  }
  let body: { target_id?: unknown; action?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { target_id, action } = body ?? {};
  if (typeof target_id !== "string" || !TARGET.test(target_id) || typeof action !== "string" || !ACTIONS.has(action)) {
    return Response.json({ error: "invalid feedback" }, { status: 400 });
  }
  const row = { target_id, action, at: new Date().toISOString() };

  const db = supabase();
  if (db) {
    const r = await fetch(`${db.url}/rest/v1/feedback`, {
      method: "POST",
      headers: { apikey: db.key, Authorization: `Bearer ${db.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!r.ok) return Response.json({ error: "store failed" }, { status: 502 });
    return Response.json({ ok: true, store: "supabase" });
  }

  // Local mode: append to a JSON file the collector imports on its next run.
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(await readFile(LOCAL_FILE, "utf8"));
  } catch {}
  rows.push(row);
  try {
    await writeFile(LOCAL_FILE, JSON.stringify(rows, null, 1));
  } catch {
    // read-only filesystem: the browser still keeps it in localStorage
    return Response.json({ ok: true, store: "none" });
  }
  return Response.json({ ok: true, store: "local" });
}
