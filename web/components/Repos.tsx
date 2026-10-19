"use client";

import { AnimatePresence, motion } from "motion/react";
import { Flame, GitFork, Star, TrendingUp } from "lucide-react";
import Link from "next/link";
import { ViewTransition, useMemo, useState } from "react";
import { cn, compact, hours, langColor, pct, scoreColor } from "@/lib/format";
import type { AiPolicy, RepoCard } from "@/lib/types";
import { useFeedback } from "./Feedback";
import { Empty, Sparkline, SpotCard } from "./ui";

export function HealthBadges({ r, compact: small = false }: { r: RepoCard; compact?: boolean }) {
  const s = r.signals;
  if (!s) return <span className="font-mono text-[10.5px] text-faint">health not measured yet</span>;
  const closed = s.outside_prs_closed_90d ?? 0;
  const merged = s.outside_prs_merged_90d ?? 0;
  const rate = closed ? merged / closed : null;
  const badges: { k: string; v: string; c: string }[] = [
    { k: "merge", v: closed ? `${merged}/${closed}` : "n/a", c: rate == null ? "var(--muted)" : rate >= 0.5 ? "var(--lime)" : rate >= 0.25 ? "var(--amber)" : "var(--rose)" },
    { k: "reply", v: hours(s.median_first_response_h), c: s.median_first_response_h == null ? "var(--muted)" : s.median_first_response_h <= 24 ? "var(--lime)" : s.median_first_response_h <= 96 ? "var(--amber)" : "var(--rose)" },
    { k: "ci", v: pct(s.ci_pass_rate), c: s.ci_pass_rate == null ? "var(--muted)" : s.ci_pass_rate >= 0.8 ? "var(--lime)" : s.ci_pass_rate >= 0.6 ? "var(--amber)" : "var(--rose)" },
  ];
  if (!small) badges.push({ k: "backlog", v: String(s.open_pr_backlog ?? "—"), c: (s.open_pr_backlog ?? 0) < 40 ? "var(--muted)" : "var(--amber)" });
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span key={b.k} className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-black/25 px-1.5 py-0.5 font-mono text-[10.5px]">
          <span className="text-faint">{b.k}</span>
          <span style={{ color: b.c }}>{b.v}</span>
        </span>
      ))}
      <PolicyBadge p={s.ai_policy} />
    </div>
  );
}

export function PolicyBadge({ p }: { p: AiPolicy }) {
  const map = { allowed: ["AI ok", "var(--lime)"], disclose: ["AI disclose", "var(--amber)"], banned: ["AI banned", "var(--rose)"], unknown: ["AI ?", "var(--faint)"] } as const;
  const [t, c] = map[p] ?? map.unknown;
  return (
    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10.5px]" style={{ color: c, background: `color-mix(in oklab, ${c} 10%, transparent)` }}>
      {t}
    </span>
  );
}

export function RepoTile({ r, i = 0 }: { r: RepoCard; i?: number }) {
  const hot = (r.velocity ?? 0) >= 200;
  return (
    <SpotCard className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
            <span className="h-2 w-2 rounded-full" style={{ background: langColor(r.language) }} />
            {r.language ?? "—"}
            <span className={cn("rounded px-1.5 py-px normal-case tracking-normal", r.source === "watchlist" ? "bg-violet/15 text-violet" : r.source === "trending" ? "bg-amber/15 text-amber" : "bg-cyan/10 text-cyan")}>
              {r.source === "search" ? "new" : r.source}
            </span>
          </div>
          <Link href={`/repo/${r.full_name}`} className="block">
            <ViewTransition name={`repo-${r.id}`} share="morph" default="none">
              <h3 className="truncate font-display text-[17px] font-semibold text-white transition-colors hover:text-cyan">{r.full_name}</h3>
            </ViewTransition>
          </Link>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold" style={{ color: scoreColor(r.score) }}>{Math.round(r.score * 100)}</div>
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">score</div>
        </div>
      </div>

      <p className="mb-4 line-clamp-2 min-h-[2.6em] text-[13px] leading-relaxed text-muted">{r.description || "No description."}</p>

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 font-mono text-[22px] font-semibold leading-none text-white">
            {hot ? <Flame className="h-5 w-5 text-amber" /> : <TrendingUp className="h-5 w-5 text-cyan" />}
            {r.velocity != null ? `+${compact(r.velocity)}` : "—"}
          </div>
          <div className="mt-1 font-mono text-[10px] text-faint">
            stars/day {r.velocity_kind === "since-creation" ? "(avg since launch)" : r.velocity_kind === "measured" ? "(24h)" : ""}
          </div>
        </div>
        <Sparkline points={r.history.map((h) => h[1])} color={hot ? "var(--amber)" : "var(--cyan)"} />
      </div>

      <div className="mt-auto space-y-3">
        <div className="flex items-center gap-4 font-mono text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" />{compact(r.stars)}</span>
          <span className="inline-flex items-center gap-1"><GitFork className="h-3.5 w-3.5" />{compact(r.forks)}</span>
          {r.open_prs != null && <span>{compact(r.open_prs)} PRs</span>}
          <span className="ml-auto text-faint">#{i + 1}</span>
        </div>
        <HealthBadges r={r} compact />
      </div>
    </SpotCard>
  );
}

type Sort = "score" | "velocity" | "stars" | "health";

export function RepoGrid({ repos }: { repos: RepoCard[] }) {
  const { state } = useFeedback();
  const [sort, setSort] = useState<Sort>("score");
  const [src, setSrc] = useState<"all" | RepoCard["source"]>("all");
  const list = useMemo(() => {
    const out = repos.filter((r) => state[`repo:${r.full_name}`] !== "hidden" && (src === "all" || r.source === src));
    const key: Record<Sort, (r: RepoCard) => number> = {
      score: (r) => r.score,
      velocity: (r) => r.velocity ?? -1,
      stars: (r) => r.stars,
      health: (r) => r.health,
    };
    return out.sort((a, b) => key[sort](b) - key[sort](a));
  }, [repos, sort, src, state]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="glass flex items-center gap-1 rounded-xl p-1">
          {(["score", "velocity", "stars", "health"] as Sort[]).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={cn("relative rounded-lg px-3 py-1.5 text-[12px] capitalize", sort === s ? "text-white" : "text-muted hover:text-white")}>
              {sort === s && <motion.span layoutId="repo-sort" className="absolute inset-0 rounded-lg bg-white/[0.09] ring-1 ring-cyan/30" />}
              <span className="relative">{s}</span>
            </button>
          ))}
        </div>
        <div className="glass flex items-center gap-1 rounded-xl p-1">
          {(["all", "search", "trending", "watchlist"] as const).map((s) => (
            <button key={s} onClick={() => setSrc(s)} className={cn("relative rounded-lg px-3 py-1.5 text-[12px]", src === s ? "text-white" : "text-muted hover:text-white")}>
              {src === s && <motion.span layoutId="repo-src" className="absolute inset-0 rounded-lg bg-white/[0.09] ring-1 ring-violet/40" />}
              <span className="relative">{s === "search" ? "new (30d)" : s}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-muted">{list.length} repos</span>
      </div>
      {list.length === 0 ? (
        <Empty title="No repos yet" hint="Run the collector to start tracking star velocity." />
      ) : (
        <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {list.map((r, i) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.035 } }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 240, damping: 28 }}
              >
                <RepoTile r={r} i={i} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
