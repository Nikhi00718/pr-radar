import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Opportunity, Snapshot } from "./types";

export type Subscriber = {
  chat_id: number;
  active: boolean;
  min_score: number;
  langs: string[];
  alerts: boolean;
  digest: boolean;
  created_at?: string;
  updated_at?: string;
  cmd_window_start: string | null;
  cmd_count: number;
};

export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 12; // commands per chat per minute
const LANG = /^[a-z0-9+#.-]{1,20}$/;

export function safeEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function esc(x: unknown): string {
  return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function href(url: string): string {
  return /^https?:\/\//.test(url) ? esc(url) : "#";
}

export function defaults(chatId: number): Subscriber {
  return { chat_id: chatId, active: true, min_score: 0.75, langs: [], alerts: true, digest: true, cmd_window_start: null, cmd_count: 0 };
}

/** -> [allowed, updated counters]. Pure so it can be tested. */
export function rateLimit(sub: Subscriber, now: number): [boolean, Pick<Subscriber, "cmd_window_start" | "cmd_count">] {
  const start = sub.cmd_window_start ? Date.parse(sub.cmd_window_start) : 0;
  if (!start || now - start > RATE_WINDOW_MS) return [true, { cmd_window_start: new Date(now).toISOString(), cmd_count: 1 }];
  const count = sub.cmd_count + 1;
  return [count <= RATE_MAX, { cmd_window_start: sub.cmd_window_start, cmd_count: count }];
}

export function matches(o: Opportunity, sub: Subscriber): boolean {
  if (o.hidden || o.score <= 0) return false;
  return !sub.langs.length || sub.langs.includes((o.language ?? "").toLowerCase());
}

const HELP = [
  "<b>PR Radar</b> finds open-source issues where an outside PR is likely to get merged.",
  "",
  "/top: top 5 issues right now",
  "/settings: your alert settings",
  "/min 80: only alert at score 80 or more (50-95)",
  "/lang python rust: only these languages (/lang all to reset)",
  "/alerts on|off: instant alerts",
  "/digest on|off: 8:00 AM IST digest",
  "/privacy: what is stored",
  "/stop: unsubscribe",
].join("\n");

function settingsText(sub: Subscriber): string {
  return [
    `<b>Your settings</b>${sub.active ? "" : " (unsubscribed: /start to resume)"}`,
    `Alerts: ${sub.alerts ? "on" : "off"} at score ${Math.round(sub.min_score * 100)}+`,
    `Daily digest: ${sub.digest ? "on" : "off"} (8:00 AM IST)`,
    `Languages: ${sub.langs.length ? sub.langs.map(esc).join(", ") : "all"}`,
    "No alerts between 00:00 and 07:00 IST.",
  ].join("\n");
}

function topText(snap: Snapshot | null, sub: Subscriber, site: string): string {
  const list = (snap?.opportunities ?? []).filter((o) => matches(o, sub)).slice(0, 5);
  if (!list.length) return "Nothing matches your settings right now. Try /lang all or check back after the next scan.";
  const lines = list.map(
    (o, i) =>
      `${i + 1}. <b>${Math.round(o.score * 100)}</b> · <a href="${href(o.url)}">${esc(o.repo)}#${o.number}</a>\n${esc(o.title)}\n<i>${esc(
        o.reasons.slice(0, 3).map((r) => r.text).join(" · "),
      )}</i>`,
  );
  return `<b>Top picks now</b>\n\n${lines.join("\n\n")}\n\n<a href="${href(site)}">Open the radar →</a>`;
}

/** Turn one command into [reply, changes to save]. Pure: no I/O, so every branch is testable. */
export function handleCommand(
  text: string,
  sub: Subscriber,
  ctx: { snapshot: () => Promise<Snapshot | null>; site: string },
): Promise<[string, Partial<Subscriber>]> | [string, Partial<Subscriber>] {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, "");
  const arg = (args[0] ?? "").toLowerCase();

  switch (cmd) {
    case "/start":
      return [
        `Subscribed. You'll get new issues scoring ${Math.round(sub.min_score * 100)}+ and a daily digest at 8:00 AM IST.\n\n${HELP}`,
        { active: true },
      ];
    case "/stop":
      return ["Unsubscribed. Nothing more will be sent. Send /start any time to come back.", { active: false }];
    case "/settings":
      return [settingsText(sub), {}];
    case "/min": {
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 50 || n > 95) return ["Send a whole number from 50 to 95, e.g. /min 80", {}];
      return [`Alerts now start at score ${n}.`, { min_score: n / 100 }];
    }
    case "/lang": {
      if (!args.length || arg === "all") return ["Showing all languages.", { langs: [] }];
      const langs = [...new Set(args.map((a) => a.toLowerCase().replace(/,$/, "")).filter((a) => LANG.test(a)))].slice(0, 5);
      if (!langs.length) return ["Example: /lang python rust (up to 5).", {}];
      return [`Only these languages now: ${langs.map(esc).join(", ")}`, { langs }];
    }
    case "/alerts":
    case "/digest": {
      const field = cmd === "/alerts" ? "alerts" : "digest";
      if (arg !== "on" && arg !== "off") return [`Use ${cmd} on or ${cmd} off`, {}];
      return [`${field === "alerts" ? "Instant alerts" : "Daily digest"} turned ${arg}.`, { [field]: arg === "on" }];
    }
    case "/top":
      return ctx.snapshot().then((snap) => [topText(snap, sub, ctx.site), {}] as [string, Partial<Subscriber>]);
    case "/privacy":
      return [
        "PR Radar stores only your Telegram chat id and the settings you choose. No name, username or messages are kept. /stop turns everything off.",
        {},
      ];
    default:
      return [HELP, {}];
  }
}
