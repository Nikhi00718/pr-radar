"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, MessageSquare, Package, Triangle } from "lucide-react";
import { useMemo, useState } from "react";
import { cn, safeUrl } from "@/lib/format";
import type { NewsItem } from "@/lib/types";
import { Ago, Empty } from "./ui";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function NewsRow({ n, i }: { n: NewsItem; i: number }) {
  const isHn = n.source === "hn";
  return (
    <motion.a
      href={safeUrl(n.url)}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex gap-4 py-4 pl-8"
    >
      <span className="absolute left-[7px] top-0 h-full w-px bg-gradient-to-b from-white/10 via-white/10 to-transparent" />
      <span
        className={cn("absolute left-0 top-5 grid h-[15px] w-[15px] place-items-center rounded-full border transition-shadow group-hover:shadow-[0_0_16px_var(--cyan)]", isHn ? "border-amber/60 bg-amber/15" : "border-violet/60 bg-violet/15")}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", isHn ? "bg-amber" : "bg-violet")} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-faint">
          {isHn ? (
            <span className="inline-flex items-center gap-1 text-amber"><Triangle className="h-3 w-3 rotate-180" />{n.points} pts</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-violet"><Package className="h-3 w-3" />release</span>
          )}
          {isHn && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{n.comments}</span>}
          <Ago iso={n.published_at} />
          <span className="truncate">{host(n.url)}</span>
        </div>
        <div className="flex items-start gap-2 text-[15px] leading-snug text-white transition-colors group-hover:text-cyan">
          <span className="flex-1">{n.title}</span>
          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {n.tags.slice(0, 5).map((t) => (
            <span key={t} className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-muted">#{t}</span>
          ))}
        </div>
      </div>
    </motion.a>
  );
}

export function NewsFeed({ items }: { items: NewsItem[] }) {
  const [src, setSrc] = useState<"all" | "hn" | "release">("all");
  const [tag, setTag] = useState<string | null>(null);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of items) for (const t of n.tags) if (t !== "release") m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [items]);
  const list = items.filter((n) => (src === "all" || n.source === src) && (!tag || n.tags.includes(tag)));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
      <div>
        <div className="glass mb-4 inline-flex items-center gap-1 rounded-xl p-1">
          {(["all", "hn", "release"] as const).map((s) => (
            <button key={s} onClick={() => setSrc(s)} className={cn("relative rounded-lg px-3 py-1.5 text-[12px]", src === s ? "text-white" : "text-muted hover:text-white")}>
              {src === s && <motion.span layoutId="news-src" className="absolute inset-0 rounded-lg bg-white/[0.09] ring-1 ring-cyan/30" />}
              <span className="relative">{s === "hn" ? "Hacker News" : s === "release" ? "Releases" : "All"}</span>
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <Empty title="Quiet skies" hint="No matching signals in the last 7 days." />
        ) : (
          <AnimatePresence mode="popLayout">
            <motion.div key={`${src}-${tag}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {list.map((n, i) => <NewsRow key={n.id} n={n} i={i} />)}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.2em] text-cyan">Frequencies</div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map(([t, n]) => (
              <button
                key={t}
                onClick={() => setTag(tag === t ? null : t)}
                className={cn("rounded-full border px-2.5 py-1 font-mono text-[11px] transition", tag === t ? "border-cyan/60 bg-cyan/10 text-white" : "border-white/10 text-muted hover:text-white")}
              >
                #{t} <span className="text-faint">{n}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function Ticker({ items }: { items: NewsItem[] }) {
  if (!items.length) return null;
  const row = items.slice(0, 16);
  return (
    <div className="glass relative overflow-hidden rounded-2xl py-3 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div className="marquee flex w-max gap-10 whitespace-nowrap">
        {[...row, ...row].map((n, i) => (
          <a key={`${n.id}-${i}`} href={safeUrl(n.url)} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-2.5 text-[13px] text-muted hover:text-white">
            <span className={cn("h-1.5 w-1.5 rounded-full", n.source === "hn" ? "bg-amber shadow-[0_0_8px_var(--amber)]" : "bg-violet shadow-[0_0_8px_var(--violet)]")} />
            <span className="font-mono text-[10.5px] text-faint">{n.source === "hn" ? `${n.points}▲` : "REL"}</span>
            {n.title}
          </a>
        ))}
      </div>
    </div>
  );
}
