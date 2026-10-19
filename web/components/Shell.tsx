"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CornerDownLeft, FolderGit2, Hash, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { scoreColor } from "@/lib/format";
import { FeedbackProvider } from "./Feedback";
import Nav from "./Nav";
import type { FeedbackRow } from "@/lib/types";

export type PaletteItem = {
  kind: "page" | "issue" | "repo";
  title: string;
  sub: string;
  href: string;
  external?: boolean;
  score?: number;
};

const PAGES: PaletteItem[] = [
  { kind: "page", title: "Radar", sub: "Overview and live sweep", href: "/" },
  { kind: "page", title: "Opportunities", sub: "Ranked issues worth a PR", href: "/opportunities" },
  { kind: "page", title: "Trending repos", sub: "Star velocity and repo health", href: "/trending" },
  { kind: "page", title: "Signals", sub: "Hacker News and releases", href: "/news" },
  { kind: "page", title: "Model lab", sub: "Score formula and the LightGBM model", href: "/lab" },
];

export default function Shell({ children, generatedAt, feedback, index }: {
  children: ReactNode; generatedAt: string; feedback: FeedbackRow[]; index: PaletteItem[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <FeedbackProvider initial={feedback}>
      <Nav generatedAt={generatedAt} onPalette={() => setOpen(true)} />
      {children}
      <AnimatePresence>{open && <Palette items={[...PAGES, ...index]} onClose={() => setOpen(false)} />}</AnimatePresence>
    </FeedbackProvider>
  );
}

function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = terms.length
      ? items.filter((it) => terms.every((t) => `${it.title} ${it.sub}`.toLowerCase().includes(t)))
      : items.filter((it) => it.kind === "page" || (it.score ?? 0) >= 0.7);
    return hits.slice(0, 40);
  }, [q, items]);

  const go = useCallback((it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    if (it.external) window.open(it.href, "_blank", "noopener");
    else router.push(it.href);
  }, [onClose, router]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const icon = (k: PaletteItem["kind"]) =>
    k === "page" ? <Sparkles className="h-4 w-4 text-violet" /> : k === "repo" ? <FolderGit2 className="h-4 w-4 text-cyan" /> : <Hash className="h-4 w-4 text-lime" />;

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-xl overflow-hidden rounded-2xl shadow-[0_30px_120px_-20px_rgba(46,230,255,0.35)]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <Search className="h-4 w-4 text-cyan" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter") go(results[sel]);
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search issues, repos, pages…"
            className="h-14 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-faint"
          />
          <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-muted">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">No signal for “{q}”.</div>}
          {results.map((it, i) => (
            <button
              key={`${it.kind}-${it.href}`}
              data-i={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(it)}
              className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${i === sel ? "text-white" : "text-muted"}`}
            >
              {i === sel && (
                <motion.span layoutId="pal-sel" className="absolute inset-0 rounded-xl bg-white/[0.07] ring-1 ring-cyan/25" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
              )}
              <span className="relative">{icon(it.kind)}</span>
              <span className="relative min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{it.title}</span>
                <span className="block truncate text-[11.5px] text-faint">{it.sub}</span>
              </span>
              {it.score != null && (
                <span className="relative font-mono text-[12px]" style={{ color: scoreColor(it.score) }}>{Math.round(it.score * 100)}</span>
              )}
              <span className="relative">{i === sel ? <CornerDownLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5 opacity-30" />}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
