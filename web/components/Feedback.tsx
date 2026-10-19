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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: target, action }),
    }).catch(() => {});
  }, []);

  const value = useMemo(() => ({ state, set, toast }), [state, set, toast]);
  return <FeedbackCtx.Provider value={value}>{children}</FeedbackCtx.Provider>;
}

export function useFeedback() {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback outside FeedbackProvider");
  return ctx;
}
