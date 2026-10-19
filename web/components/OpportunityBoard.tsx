"use client";

import { AnimatePresence, motion } from "motion/react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { cn, langColor } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import { useFeedback } from "./Feedback";
import OpportunityCard from "./OpportunityCard";
import { Empty } from "./ui";

const LABEL_KINDS = [
  { id: "all", label: "All" },
  { id: "gfi", label: "Good first issue", test: (l: string) => /good.?first|beginner|easy/.test(l) },
  { id: "help", label: "Help wanted", test: (l: string) => /help.?wanted|contributions welcome/.test(l) },
  { id: "bug", label: "Bug", test: (l: string) => /bug/.test(l) },
] as const;

type Sort = "mix" | "score" | "new" | "quiet";

export default function OpportunityBoard({ items, blocked }: { items: Opportunity[]; blocked: Opportunity[] }) {
  const { state } = useFeedback();
  const [q, setQ] = useState("");
  const [lang, setLang] = useState<string>("all");
  const [kind, setKind] = useState<(typeof LABEL_KINDS)[number]["id"]>("all");
  const [min, setMin] = useState(0);
  const [sort, setSort] = useState<Sort>("mix");
  const [showBlocked, setShowBlocked] = useState(false);
  const [showMine, setShowMine] = useState(false);
  const [limit, setLimit] = useState(30);
  const dq = useDeferredValue(q);

  const langs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of items) if (o.language) counts.set(o.language, (counts.get(o.language) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [items]);

  const list = useMemo(() => {
    const pool = showBlocked ? [...items, ...blocked] : items;
    const terms = dq.toLowerCase().split(/\s+/).filter(Boolean);
    const test = LABEL_KINDS.find((k) => k.id === kind);
    const out = pool.filter((o) => {
      const fb = state[`issue:${o.id}`];
      const repoHidden = state[`repo:${o.repo}`] === "hidden";
      if (showMine) return fb === "working" || fb === "opened_pr";
      if (fb === "ignored" || repoHidden || (o.hidden && !fb)) return false;
      if (lang !== "all" && o.language !== lang) return false;
      if (o.score < min / 100 && !(showBlocked && o.score === 0)) return false;
      if (test && "test" in test && !o.labels.some((l) => test.test(l.toLowerCase()))) return false;
      if (terms.length) {
        const hay = `${o.title} ${o.repo} ${o.labels.join(" ")}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    if (sort === "score") out.sort((a, b) => b.score - a.score);
    if (sort === "new") out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sort === "quiet") out.sort((a, b) => a.comments - b.comments || b.score - a.score);
    return out;
  }, [items, blocked, showBlocked, dq, kind, lang, min, sort, state, showMine]);

  const mineCount = Object.entries(state).filter(([k, v]) => k.startsWith("issue:") && (v === "working" || v === "opened_pr")).length;

  return (
    <div>
      <div className="glass sticky top-[76px] z-30 mb-6 rounded-2xl p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 focus-within:border-cyan/50 focus-within:shadow-[0_0_0_4px_rgba(46,230,255,0.08)]">
            <Search className="h-4 w-4 text-muted" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setLimit(30); }}
              placeholder="Filter by words, repo, label…"
              className="h-10 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-faint"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-black/30 p-1">
            {LABEL_KINDS.map((k) => (
              <Seg key={k.id} active={kind === k.id} onClick={() => setKind(k.id)} id="kind">{k.label}</Seg>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-black/30 p-1">
            {(["mix", "score", "new", "quiet"] as Sort[]).map((s) => (
              <Seg key={s} active={sort === s} onClick={() => setSort(s)} id="sort">
                {s === "mix" ? "Best mix" : s === "score" ? "Score" : s === "new" ? "Newest" : "Quietest"}
              </Seg>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={lang === "all"} onClick={() => setLang("all")}>All languages</Chip>
            {langs.map(([l, n]) => (
              <Chip key={l} active={lang === l} onClick={() => setLang(l)}>
                <span className="h-2 w-2 rounded-full" style={{ background: langColor(l) }} />
                {l} <span className="text-faint">{n}</span>
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-3 font-mono text-[11px] text-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" /> min score
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={min}
              onChange={(e) => setMin(Number(e.target.value))}
              className="range w-32"
              style={{ ["--fill" as string]: `${(min / 90) * 100}%` }}
            />
            <span className="w-6 text-white">{min}</span>
          </label>
          <Toggle on={showBlocked} set={setShowBlocked}>show claimed / blocked</Toggle>
          <Toggle on={showMine} set={setShowMine}>my work {mineCount ? `(${mineCount})` : ""}</Toggle>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between font-mono text-[11px] text-muted">
        <span>
          <span className="text-white">{list.length}</span> matching · showing {Math.min(limit, list.length)}
        </span>
        <span className="hidden sm:inline">tip: press <kbd className="rounded border border-white/10 px-1">/</kbd> to search everything</span>
      </div>

      {list.length === 0 ? (
        <Empty title="Nothing on the scope" hint="Loosen the filters, lower the minimum score, or wait for the next scan." />
      ) : (
        <motion.div layout className="grid gap-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {list.slice(0, limit).map((o, i) => (
              <motion.div
                key={o.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: Math.min(i, 10) * 0.03 } }}
                exit={{ opacity: 0, x: -40, scale: 0.96, transition: { duration: 0.25 } }}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
              >
                <OpportunityCard o={o} rank={i + 1} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {limit < list.length && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + 30)}
            className="group relative overflow-hidden rounded-xl border border-cyan/30 px-6 py-2.5 text-sm text-cyan transition hover:border-cyan/70 hover:text-white"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-cyan/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            Load {Math.min(30, list.length - limit)} more
          </button>
        </div>
      )}
    </div>
  );
}

function Seg({ active, onClick, children, id }: { active: boolean; onClick: () => void; children: React.ReactNode; id: string }) {
  return (
    <button onClick={onClick} className={cn("relative rounded-lg px-3 py-1.5 text-[12px] transition-colors", active ? "text-white" : "text-muted hover:text-white")}>
      {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-white/[0.09] ring-1 ring-cyan/30" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
      <span className="relative">{children}</span>
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition",
        active ? "border-cyan/50 bg-cyan/10 text-white" : "border-white/10 text-muted hover:border-white/25 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button onClick={() => set(!on)} className="flex items-center gap-2 font-mono text-[11px] text-muted hover:text-white">
      <span className={cn("relative h-4 w-7 rounded-full transition-colors", on ? "bg-cyan/60" : "bg-white/10")}>
        <motion.span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow"
          animate={{ left: on ? 14 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </span>
      {children}
    </button>
  );
}
