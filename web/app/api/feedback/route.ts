import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ACTIONS = new Set(["working", "opened_pr", "merged", "ignored", "hidden", "cleared"]);
const TARGET = /^(issue:\d+|repo:[\w.-]+\/[\w.-]+)$/;

export async function POST(req: Request) {
  let body: { target_id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { target_id, action } = body;
  if (!target_id || !TARGET.test(target_id) || !action || !ACTIONS.has(action)) {
    return Response.json({ error: "invalid feedback" }, { status: 400 });
  }
  const row = { target_id, action, at: new Date().toISOString() };

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const r = await fetch(`${url}/rest/v1/feedback`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!r.ok) return Response.json({ error: `supabase ${r.status}` }, { status: 502 });
    return Response.json({ ok: true, store: "supabase" });
  }

  // Local mode: append to a JSON file the collector imports on its next run.
  const file = path.join(process.cwd(), "data", "feedback.local.json");
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  rows.push(row);
  try {
    await writeFile(file, JSON.stringify(rows, null, 1));
  } catch {
    // read-only filesystem (e.g. Vercel without Supabase): the browser still keeps it in localStorage
    return Response.json({ ok: true, store: "none" });
  }
  return Response.json({ ok: true, store: "local" });
}
