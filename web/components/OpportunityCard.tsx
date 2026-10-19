"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, EyeOff, GitPullRequestArrow, Hammer, MessageSquare, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn, langColor, safeUrl } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import { useFeedback } from "./Feedback";
import { Ago, Label, Meter, ReasonChip, ScoreRing, SpotCard } from "./ui";

const PART_LABELS: Record<string, [string, number]> = {
  merge_rate: ["Outside merge rate", 0.45],
  fast_response: ["Fast first response", 0.2],
  low_backlog: ["Low PR backlog", 0.1],
  active_maintainers: ["Active maintainers", 0.1],
  fresh_unclaimed: ["Fresh & unclaimed", 0.1],
  label_bonus: ["Label bonus", 0.05],
};

const POLICY: Record<string, { text: string; c: string } | undefined> = {
  disclose: { text: "AI: disclose", c: "var(--amber)" },
  banned: { text: "AI: banned", c: "var(--rose)" },
  allowed: { text: "AI: ok", c: "var(--lime)" },
};

export default function OpportunityCard({ o, rank }: { o: Opportunity; rank?: number }) {
  const [open, setOpen] = useState(false);
  const { state, set } = useFeedback();
  const mine = state[`issue:${o.id}`];
  const blocked = o.score === 0;
  const policy = POLICY[o.ai_policy];

  return (
    <SpotCard as="article" className={cn("group p-4 sm:p-5", mine === "working" && "ring-1 ring-lime/40")}>
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={o.score} />
          {rank != null && <span className="font-mono text-[10px] text-faint">#{rank}</span>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: langColor(o.language) }} />
            <Link href={`/repo/${o.repo}`} className="transition-colors hover:text-cyan">{o.repo}</Link>
            <span className="text-faint">#{o.number}</span>
            <span className="text-faint">·</span>
            <Ago iso={o.created_at} />
            <span className="inline-flex items-center gap-1 text-faint"><MessageSquare className="h-3 w-3" />{o.comments}</span>
            {policy && (
              <span className="rounded px-1.5 py-px text-[10px]" style={{ color: policy.c, background: `color-mix(in oklab, ${policy.c} 12%, transparent)` }}>
                {policy.text}
              </span>
            )}
            {mine === "working" && (
              <span className="rounded bg-lime/15 px-1.5 py-px text-[10px] text-lime">working on it</span>
            )}
          </div>

          <a
            href={safeUrl(o.url)}
            target="_blank"
            rel="noreferrer"
            className="block text-[15.5px] font-medium leading-snug text-white decoration-cyan/60 underline-offset-4 transition-colors hover:text-cyan hover:underline"
          >
            {o.title}
          </a>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.labels.slice(0, 4).map((l) => <Label key={l} name={l} />)}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {o.reasons.slice(0, 5).map((r) => <ReasonChip key={r.text} r={r} />)}
          </div>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 grid gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-4 sm:grid-cols-2">
                  {Object.entries(PART_LABELS).map(([k, [label, w]]) => (
                    <Meter
                      key={k}
                      label={`${label} ×${w}`}
                      value={o.parts[k] ?? 0}
                      display={`${Math.round((o.parts[k] ?? 0) * 100)}`}
                      color={k === "merge_rate" ? "var(--lime)" : k === "fast_response" ? "var(--cyan)" : "var(--violet)"}
                    />
                  ))}
                  {o.parts.my_merges != null && (
                    <Meter
                      label="Your merges here (added on top)"
                      value={o.parts.my_merges / 0.12}
                      display={`+${Math.round(o.parts.my_merges * 100)}`}
                      color="var(--lime)"
                    />
                  )}
                  {blocked && (
                    <div className="text-[12px] text-rose sm:col-span-2">Hard gate: {o.reasons[0]?.text}. The score is forced to 0.</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ActionButton
              active={mine === "working"}
              onClick={() => set(`issue:${o.id}`, mine === "working" ? "cleared" : "working")}
              icon={mine === "working" ? <Undo2 className="h-3.5 w-3.5" /> : <Hammer className="h-3.5 w-3.5" />}
              label={mine === "working" ? "Undo" : "Working on it"}
              tone="lime"
            />
            {mine === "working" && (
              <ActionButton
                onClick={() => set(`issue:${o.id}`, "opened_pr")}
                icon={<GitPullRequestArrow className="h-3.5 w-3.5" />}
                label="PR opened"
                tone="cyan"
              />
            )}
            <ActionButton onClick={() => set(`issue:${o.id}`, "ignored")} icon={<X className="h-3.5 w-3.5" />} label="Ignore" tone="muted" />
            <ActionButton onClick={() => set(`repo:${o.repo}`, "hidden")} icon={<EyeOff className="h-3.5 w-3.5" />} label="Hide repo" tone="muted" />
            <button
              onClick={() => setOpen((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[11px] text-muted transition hover:text-white"
            >
              why {Math.round(o.score * 100)}?
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </button>
          </div>
        </div>
      </div>
    </SpotCard>
  );
}

function ActionButton({ onClick, icon, label, tone, active }: {
  onClick: () => void; icon: React.ReactNode; label: string; tone: "lime" | "cyan" | "muted"; active?: boolean;
}) {
  const c = tone === "lime" ? "var(--lime)" : tone === "cyan" ? "var(--cyan)" : "var(--muted)";
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors hover:text-white"
      style={{
        color: c,
        borderColor: `color-mix(in oklab, ${c} ${active ? 60 : 22}%, transparent)`,
        background: `color-mix(in oklab, ${c} ${active ? 16 : 5}%, transparent)`,
      }}
    >
      {icon}
      {label}
    </motion.button>
  );
}
