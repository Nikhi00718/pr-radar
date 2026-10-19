"use client";

import { motion } from "motion/react";
import { ArrowRight, Send, Zap } from "lucide-react";
import Link from "next/link";
import { TELEGRAM_BOT_URL } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import RadarScope from "./Radar";
import { CountUp } from "./ui";

const word = {
  hidden: { opacity: 0, y: 40, rotateX: -70, filter: "blur(8px)" },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    rotateX: 0,
    filter: "blur(0px)",
    transition: { delay: 0.15 + i * 0.07, duration: 0.9, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export default function Hero({ items, stats }: {
  items: Opportunity[];
  stats: { hot: number; opportunities: number; repos: number; medianReply: number | null; banned: number };
}) {
  const line1 = ["Find", "the", "PR"];
  const line2 = ["worth", "opening", "today."];
  return (
    <section className="relative grid items-center gap-10 pb-12 pt-4 lg:grid-cols-[1.05fr_1fr] lg:gap-6">
      <div className="relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan/25 bg-cyan/[0.06] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-cyan"
        >
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-lime text-lime" />
          live · scanning {stats.repos} repos
        </motion.div>

        <h1 className="font-display text-[44px] font-semibold leading-[0.98] tracking-[-0.03em] text-white [perspective:600px] sm:text-6xl lg:text-[72px]">
          <span className="block">
            {line1.map((w, i) => (
              <motion.span key={w} custom={i} variants={word} initial="hidden" animate="show" className="mr-[0.22em] inline-block origin-bottom">
                {w}
              </motion.span>
            ))}
          </span>
          <span className="block">
            {line2.map((w, i) => (
              <motion.span key={w} custom={i + 3} variants={word} initial="hidden" animate="show" className="text-gradient mr-[0.22em] inline-block origin-bottom">
                {w}
              </motion.span>
            ))}
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.8 }}
          className="mt-6 max-w-lg text-[16px] leading-relaxed text-muted"
        >
          PR Radar watches GitHub around the clock and ranks open issues by how likely an outside PR is to get merged:
          maintainer reply speed, outsider merge rate, backlog and AI-use rules, with the reasons spelled out.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.8 }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <Link
            href="/opportunities"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-cyan to-violet px-5 py-3 text-sm font-semibold text-[#04050a] shadow-[0_0_40px_-6px_var(--cyan)] transition-shadow hover:shadow-[0_0_60px_-4px_var(--cyan)]"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Zap className="relative h-4 w-4" />
            <span className="relative">Show me opportunities</span>
            <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link href="/trending" className="rounded-xl border border-white/15 px-5 py-3 text-sm text-white/90 transition hover:border-white/30 hover:bg-white/[0.04]">
            Trending repos
          </Link>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 rounded-xl border border-[#2aabee]/40 bg-[#2aabee]/10 px-5 py-3 text-sm text-[#7fd0ff] transition hover:border-[#2aabee]/80 hover:bg-[#2aabee]/20 hover:text-white"
          >
            <Send className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            Get alerts on Telegram
          </a>
        </motion.div>

        <div className="mt-10 grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { v: stats.hot, l: "hot (75+)", c: "text-lime" },
            { v: stats.opportunities, l: "open targets", c: "text-cyan" },
            { v: stats.medianReply ?? 0, l: "median reply, hours", c: "text-violet" },
            { v: stats.banned, l: "AI-banned repos skipped", c: "text-rose" },
          ].map((s, i) => (
            <motion.div
              key={s.l}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 + i * 0.08 }}
              className="glass rounded-xl px-3 py-3"
            >
              <CountUp value={s.v} className={`font-mono text-2xl font-semibold ${s.c}`} />
              <div className="mt-0.5 text-[10.5px] leading-tight text-faint">{s.l}</div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="relative">
        <RadarScope items={items} />
        <div className="mt-4 flex flex-wrap justify-center gap-5 font-mono text-[10.5px] text-faint">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-lime" />75+ hot</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan" />60-75</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet" />45-60</span>
          <span>closer to centre = better odds</span>
        </div>
      </div>
    </section>
  );
}
