"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { hash01, scoreColor, safeUrl } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

const PERIOD = 6;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const radiusFor = (score: number) => Math.min(0.92, 0.1 + (1 - Math.min(1, score)) * 1.6);

/** The hero: a sweeping radar where each blip is a live opportunity. Closer to the centre = higher score. */
export default function RadarScope({ items }: { items: Opportunity[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const blips = useMemo(
    () =>
      items.slice(0, 30).map((o) => {
        const angle = (hash01(o.repo) * 360 + hash01(String(o.id)) * 50 - 25 + 360) % 360;
        const r = radiusFor(o.score);
        const rad = ((angle - 90) * Math.PI) / 180;
        return { o, angle, x: r3(50 + Math.cos(rad) * r * 50), y: r3(50 + Math.sin(rad) * r * 50) };
      }),
    [items],
  );
  const hovered = blips.find((b) => b.o.id === hover);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]" style={{ ["--period" as string]: `${PERIOD}s` }}>
      <div className="absolute inset-[-8%] rounded-full bg-[radial-gradient(circle,rgba(46,230,255,0.16),transparent_62%)] blur-2xl" />
      <motion.div
        initial={{ scale: 0.6, opacity: 0, rotate: -40 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0 overflow-hidden rounded-full border border-cyan/25 bg-[radial-gradient(circle,rgba(8,20,40,0.85),rgba(4,6,14,0.95))] shadow-[inset_0_0_80px_rgba(46,230,255,0.12),0_0_60px_-10px_rgba(46,230,255,0.4)]"
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          {[0.25, 0.5, 0.75, 1].map((k) => (
            <circle key={k} cx="50" cy="50" r={k * 49.5} fill="none" stroke="rgba(46,230,255,0.16)" strokeWidth="0.2" />
          ))}
          <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(46,230,255,0.12)" strokeWidth="0.15" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(46,230,255,0.12)" strokeWidth="0.15" />
          <line x1="15" y1="15" x2="85" y2="85" stroke="rgba(46,230,255,0.06)" strokeWidth="0.15" />
          <line x1="85" y1="15" x2="15" y2="85" stroke="rgba(46,230,255,0.06)" strokeWidth="0.15" />
          {Array.from({ length: 72 }, (_, i) => {
            const a = (i * 5 * Math.PI) / 180;
            const r1 = i % 6 === 0 ? 46.5 : 48;
            return (
              <line
                key={i}
                x1={r3(50 + Math.cos(a) * r1)}
                y1={r3(50 + Math.sin(a) * r1)}
                x2={r3(50 + Math.cos(a) * 49.5)}
                y2={r3(50 + Math.sin(a) * 49.5)}
                stroke="rgba(46,230,255,0.35)"
                strokeWidth="0.2"
              />
            );
          })}
          {[90, 75, 60].map((s) => (
            <g key={s}>
              <circle cx="50" cy="50" r={r3(radiusFor(s / 100) * 50)} fill="none" stroke="rgba(180,255,79,0.18)" strokeWidth="0.15" strokeDasharray="0.6 1.2" />
              <text x="50.8" y={r3(50 - radiusFor(s / 100) * 50 - 0.6)} fontSize="1.9" fill="rgba(46,230,255,0.5)" fontFamily="monospace">
                {s}
              </text>
            </g>
          ))}
        </svg>
        <div className="radar-sweep" />
        <div className="radar-beam" />
        <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan shadow-[0_0_20px_4px_var(--cyan)]" />
      </motion.div>

      {blips.map(({ o, angle, x, y }, i) => {
        const c = scoreColor(o.score);
        const delay = `${r3((angle / 360) * PERIOD - PERIOD)}s`;
        return (
          <motion.a
            key={o.id}
            href={safeUrl(o.url)}
            target="_blank"
            rel="noreferrer"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 + i * 0.04, type: "spring", stiffness: 300, damping: 18 }}
            onMouseEnter={() => setHover(o.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(o.id)}
            onBlur={() => setHover(null)}
            className="absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center"
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-label={`${o.repo}#${o.number}: ${o.title}`}
          >
            <span
              className="blip absolute left-1/2 top-1/2 block h-2.5 w-2.5 rounded-full"
              style={{ ["--delay" as string]: delay, background: c, boxShadow: `0 0 12px 2px ${c}` }}
            />
            <span
              className="blip-ring absolute left-1/2 top-1/2 block h-2.5 w-2.5 rounded-full border"
              style={{ ["--delay" as string]: delay, borderColor: c }}
            />
            {hover === o.id && <span className="absolute inset-0 rounded-full border border-white/70" />}
          </motion.a>
        );
      })}

      <AnimatePresence>
        {hovered && (
          <motion.div
            key={hovered.o.id}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="glass pointer-events-none absolute z-20 w-64 rounded-xl p-3 text-left shadow-[0_20px_60px_-10px_rgba(0,0,0,0.9)]"
            style={{
              left: `clamp(0px, calc(${hovered.x}% - 128px), calc(100% - 256px))`,
              top: hovered.y > 55 ? `calc(${hovered.y}% - 124px)` : `calc(${hovered.y}% + 18px)`,
            }}
          >
            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10.5px] text-muted">
              <span className="truncate">{hovered.o.repo}#{hovered.o.number}</span>
              <span style={{ color: scoreColor(hovered.o.score) }}>{Math.round(hovered.o.score * 100)}</span>
            </div>
            <div className="line-clamp-2 text-[13px] leading-snug text-white">{hovered.o.title}</div>
            <div className="mt-1.5 truncate text-[11px] text-muted">
              {hovered.o.reasons.slice(1, 3).map((r) => r.text).join(" · ")}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
