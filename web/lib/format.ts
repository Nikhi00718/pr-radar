import type { Tone } from "./types";

export function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: n < 10_000 ? 1 : 0 }).format(n);
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo ago`;
  return `${Math.floor(s / 86400 / 365)}y ago`;
}

export function hours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export function pct(x: number | null | undefined): string {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}

/** score in [0,1] -> accent color */
export function scoreColor(score: number): string {
  if (score >= 0.75) return "var(--lime)";
  if (score >= 0.6) return "var(--cyan)";
  if (score >= 0.45) return "var(--violet)";
  if (score > 0) return "var(--amber)";
  return "var(--rose)";
}

export const toneColor: Record<Tone, string> = {
  good: "var(--lime)",
  warn: "var(--amber)",
  bad: "var(--rose)",
  info: "var(--muted)",
};

export const LANG_COLORS: Record<string, string> = {
  Python: "#3b82f6",
  TypeScript: "#38bdf8",
  JavaScript: "#facc15",
  Rust: "#f97316",
  Go: "#22d3ee",
  "C++": "#f472b6",
  C: "#a3a3a3",
  Java: "#ef4444",
  Jupyter: "#fb923c",
  "Jupyter Notebook": "#fb923c",
  Shell: "#84cc16",
  Cuda: "#76b900",
  Swift: "#fb7185",
  Kotlin: "#a78bfa",
  Zig: "#f59e0b",
};

export function langColor(lang: string | null | undefined): string {
  return (lang && LANG_COLORS[lang]) || "#8b93ad";
}

/** stable 0..1 hash for placing things on the radar */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
