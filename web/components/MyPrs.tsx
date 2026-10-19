"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { useMemo, useState } from "react";
import { cn, hours } from "@/lib/format";
import type { MyPr, MyPrs } from "@/lib/types";
import { Ago, CountUp, Empty, SpotCard } from "./ui";

const STATE: Record<MyPr["state"], { c: string; label: string }> = {
  OPEN: { c: "var(--cyan)", label: "open" },
  MERGED: { c: "var(--lime)", label: "merged" },
  CLOSED: { c: "var(--rose)", label: "closed" },
};

type Filter = "ALL" | MyPr["state"];

export function MyPrStats({ data }: { data: MyPrs }) {
  const s = data.stats;
  const tiles: { label: string; value: number | null; decimals?: number; suffix?: string; text?: string; c: string }[] = [
    { label: "opened", value: s.opened, c: "var(--cyan)" },
    { label: "merged", value: s.merged, c: "var(--lime)" },
    { label: "merge rate", value: s.merge_rate == null ? null : s.merge_rate * 100, suffix: "%", c: "var(--violet)" },
    { label: "median time to merge", value: null, text: hours(s.median_merge_h), c: "var(--amber)" },
  ];
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <SpotCard className="p-5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-faint">{t.label}</div>
            <div className="mt-2 font-display text-3xl font-semibold tracking-tight" style={{ color: t.c }}>
              {t.value != null ? <CountUp value={t.value} decimals={t.decimals} suffix={t.suffix} /> : (t.text ?? "—")}
            </div>
          </SpotCard>
        </motion.div>
      ))}
      <div className="col-span-2 font-mono text-[11px] text-faint md:col-span-4">
        upstream only: {s.open} open · {s.closed} closed without merge · {s.repos} repos · merge rate counts decided PRs
        {s.own_repo_prs ? ` · ${s.own_repo_prs} PRs to your own repos are listed below but not counted` : ""}
      </div>
    </div>
  );
}

export function MyRepos({ data }: { data: MyPrs }) {
  const top = data.repos.filter((r) => r.merged > 0).slice(0, 12);
  if (!top.length) return null;
  const max = Math.max(...top.map((r) => r.opened));
  return (
    <SpotCard className="mb-8 p-5 sm:p-6">
      <div className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.2em] text-faint">
        where you merge · these repos get a score boost
      </div>
      <div className="space-y-2.5">
        {top.map((r, i) => (
          <div key={r.repo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]">
            <div className="min-w-0">
              <div className="mb-1 truncate font-mono text-muted">{r.repo}</div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-white/15"
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(r.opened / max) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                />
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: "var(--lime)", boxShadow: "0 0 10px var(--lime)" }}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(r.merged / max) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.1, delay: i * 0.03 + 0.1, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
            <span className="font-mono text-white">
              {r.merged}<span className="text-faint">/{r.opened}</span>
            </span>
          </div>
        ))}
      </div>
    </SpotCard>
  );
}

function Icon({ pr }: { pr: MyPr }) {
  const cls = "h-4 w-4";
  if (pr.state === "MERGED") return <GitMerge className={cls} />;
  if (pr.state === "CLOSED") return <GitPullRequestClosed className={cls} />;
  if (pr.is_draft) return <GitPullRequestDraft className={cls} />;
  return <GitPullRequest className={cls} />;
}

export function MyPrList({ prs }: { prs: MyPr[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: prs.length, OPEN: 0, MERGED: 0, CLOSED: 0 };
    for (const p of prs) c[p.state]++;
    return c;
  }, [prs]);
  const shown = filter === "ALL" ? prs : prs.filter((p) => p.state === filter);

  if (!prs.length) {
    return <Empty title="No PRs collected yet" hint="Run the collector with a GitHub token; the my_prs step searches author:<login> is:pr." />;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["ALL", "OPEN", "MERGED", "CLOSED"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="relative rounded-xl px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-white"
          >
            {filter === f && (
              <motion.span
                layoutId="mypr-filter"
                className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className={cn("relative", filter === f && "text-white")}>
              {f === "ALL" ? "all" : STATE[f].label} <span className="font-mono text-faint">{counts[f]}</span>
            </span>
          </button>
        ))}
      </div>

      <SpotCard className="divide-y divide-white/[0.05] px-2 sm:px-3">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.slice(0, 200).map((p, i) => {
            const st = STATE[p.state];
            const mergeH = p.merged_at ? (Date.parse(p.merged_at) - Date.parse(p.created_at)) / 3.6e6 : null;
            return (
              <motion.a
                key={p.id}
                layout
                href={p.url}
                target="_blank"
                rel="noreferrer"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.025, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="group flex items-start gap-3 px-2 py-3.5"
              >
                <span
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                  style={{ color: st.c, background: `color-mix(in oklab, ${st.c} 12%, transparent)` }}
                >
                  <Icon pr={p} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted">
                    <span>{p.repo}</span>
                    <span className="text-faint">#{p.number}</span>
                    <span className="text-faint">·</span>
                    <span className="text-faint">opened <Ago iso={p.created_at} /></span>
                    {mergeH != null && <span style={{ color: st.c }}>merged in {hours(mergeH)}</span>}
                    {p.state === "OPEN" && p.is_draft && <span className="text-faint">draft</span>}
                  </div>
                  <div className="flex items-start gap-2 text-[14.5px] leading-snug text-white transition-colors group-hover:text-cyan">
                    <span className="flex-1">{p.title}</span>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                </div>
              </motion.a>
            );
          })}
        </AnimatePresence>
      </SpotCard>
      {shown.length > 200 && <div className="mt-3 font-mono text-[11px] text-faint">showing the newest 200 of {shown.length}</div>}
    </>
  );
}
