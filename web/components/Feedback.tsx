"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeedbackAction, FeedbackRow } from "@/lib/types";

type State = Record<string, FeedbackAction>;
type Ctx = {
  state: State;
  set: (target: string, action: FeedbackAction | "cleared") => void;
  toast: string | null;
};

const FeedbackCtx = createContext<Ctx | null>(null);
const KEY = "pr-radar:feedback";
const OWNER_KEY = "pr-radar:owner-key";

/** One-time unlock link: https://site/#key=<FEEDBACK_KEY>. The fragment never reaches the server or its logs. */
function readOwnerKey(): string {
  try {
    const m = window.location.hash.match(/(?:^#|&)key=([^&]+)/);
    if (m) {
      localStorage.setItem(OWNER_KEY, decodeURIComponent(m[1]));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    return localStorage.getItem(OWNER_KEY) ?? "";
  } catch {
    return "";
  }
}

function latest(rows: FeedbackRow[]): State {
  const out: State = {};
  for (const r of [...rows].sort((a, b) => a.at.localeCompare(b.at))) {
    if ((r.action as string) === "cleared") delete out[r.target_id];
    else out[r.target_id] = r.action;
  }
  return out;
}

export function FeedbackProvider({ initial, children }: { initial: FeedbackRow[]; children: ReactNode }) {
  const [state, setState] = useState<State>(() => latest(initial));
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      readOwnerKey(); // consume a #key= unlock link as soon as the page loads
      const local = JSON.parse(localStorage.getItem(KEY) || "{}") as State;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- merge browser-local clicks after hydration
      setState((s) => ({ ...s, ...local }));
    } catch {}
  }, []);

  const set = useCallback((target: string, action: FeedbackAction | "cleared") => {
    setState((s) => {
      const next = { ...s };
      if (action === "cleared") delete next[target];
      else next[target] = action;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    const msg: Record<string, string> = {
      working: "Marked as working on it",
      opened_pr: "Logged: PR opened",
      merged: "Logged: merged",
      ignored: "Ignored — it won't come back",
      hidden: "Repo hidden from the radar",
      cleared: "Undone",
    };
    setToast(msg[action]);
    setTimeout(() => setToast(null), 2200);
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-radar-key": readOwnerKey() },
      body: JSON.stringify({ target_id: target, action }),
    })
      .then((r) => {
        if (r.status === 401) setToast("Saved on this device only (open your unlock link to sync)");
      })
      .catch(() => {});
  }, []);

  const value = useMemo(() => ({ state, set, toast }), [state, set, toast]);
  return <FeedbackCtx.Provider value={value}>{children}</FeedbackCtx.Provider>;
}

export function useFeedback() {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback outside FeedbackProvider");
  return ctx;
}
