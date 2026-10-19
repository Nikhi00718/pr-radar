import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";
import type { ModelReport, Snapshot } from "./types";

const EMPTY: Snapshot = {
  generated_at: new Date(0).toISOString(),
  model_version: "none",
  stats: { repos: 0, issues: 0, opportunities: 0, blocked: 0, hot: 0, news: 0, ai_banned_repos: 0 },
  opportunities: [],
  blocked: [],
  repos: [],
  news: [],
  feedback: [],
};

async function fromSupabase(): Promise<Snapshot | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const snapRes = await fetch(`${url}/rest/v1/site_snapshot?select=payload&id=eq.1`, { headers });
  if (!snapRes.ok) throw new Error(`supabase snapshot ${snapRes.status}`);
  const rows = (await snapRes.json()) as { payload: Snapshot }[];
  return rows.length ? rows[0].payload : null;
}

async function fromFile(): Promise<Snapshot | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "snapshot.json"), "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

export async function getSnapshot(): Promise<Snapshot> {
  "use cache";
  cacheLife("minutes");
  let snap: Snapshot;
  try {
    snap = (await fromSupabase()) ?? (await fromFile()) ?? EMPTY;
  } catch (e) {
    console.error("snapshot load failed, falling back to local file", e);
    snap = (await fromFile()) ?? EMPTY;
  }
  // Private data never reaches the page: feedback is fetched client-side with the owner key, and an older
  // snapshot that still carries the owner's PR list has it dropped here.
  const { my_prs: _privatePrs, ...publicSnap } = snap as Snapshot & { my_prs?: unknown };
  void _privatePrs;
  return { ...publicSnap, feedback: [] };
}

export async function getModelReport(): Promise<ModelReport> {
  "use cache";
  cacheLife("hours");
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "model_report.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
