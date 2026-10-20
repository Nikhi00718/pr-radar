"use client";

import { AnimatePresence, motion } from "motion/react";
import { Command, Radar } from "lucide-react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Ago } from "./ui";
import { useFeedback } from "./Feedback";

const LINKS = [
  { href: "/", label: "Radar" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/trending", label: "Trending" },
  { href: "/news", label: "Signals" },
  { href: "/lab", label: "Model lab" },
];

export default function Nav({ generatedAt, onPalette }: { generatedAt: string; onPalette: () => void }) {
  // The route segment, not usePathname(): when Vercel regenerates the "/" prerender the server-side pathname is not
  // "/", so the server HTML had no active pill while the client drew one (React #418 on hydration).
  const segment = useSelectedLayoutSegment();
  const active = LINKS.find((l) => l.href === (segment === null ? "/" : `/${segment}`))?.href;
  const { toast } = useFeedback();
  const fresh = Date.parse(generatedAt) > 0;

  return (
    <>
      <motion.header
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-x-0 top-3 z-50 flex justify-center px-3"
      >
        <nav className="glass flex w-full max-w-6xl items-center gap-2 rounded-2xl px-2.5 py-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] sm:gap-4 sm:px-4">
          <Link href="/" className="group flex items-center gap-2 pr-1">
            <span className="relative grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-cyan/30 to-violet/30 ring-1 ring-white/15">
              <Radar className="h-4 w-4 text-cyan transition-transform duration-700 group-hover:rotate-[360deg]" />
            </span>
            <span className="hidden font-display text-[15px] font-semibold tracking-tight text-white sm:block">
              PR<span className="text-cyan">·</span>Radar
            </span>
          </Link>

          <div className="no-scrollbar flex flex-1 items-center gap-0.5 overflow-x-auto">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="relative shrink-0 rounded-xl px-3 py-1.5 text-[13px] text-muted transition-colors hover:text-white"
              >
                {active === l.href && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className={`relative ${active === l.href ? "text-white" : ""}`}>{l.label}</span>
              </Link>
            ))}
          </div>

          <div className="hidden items-center gap-2 font-mono text-[11px] text-muted md:flex">
            <span className={`pulse-dot h-1.5 w-1.5 rounded-full ${fresh ? "bg-lime text-lime" : "bg-amber text-amber"}`} />
            {fresh ? <>scan <Ago iso={generatedAt} /></> : "no scan yet"}
          </div>

          <button
            onClick={onPalette}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-muted transition hover:border-cyan/40 hover:text-white"
            aria-label="Open command palette"
          >
            <Command className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">K</span>
          </button>
        </nav>
      </motion.header>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="glass fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm text-white shadow-[0_0_40px_-8px_var(--cyan)]"
          >
            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-cyan align-middle shadow-[0_0_10px_var(--cyan)]" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
