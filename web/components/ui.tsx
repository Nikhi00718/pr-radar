"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useId, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ago, cn, scoreColor, toneColor } from "@/lib/format";
import type { Reason } from "@/lib/types";

/** Card whose border lights up where the pointer is. */
export function SpotCard({
  children,
  className,
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "article" | "section";
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Tag
      ref={ref}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        ref.current!.style.setProperty("--mx", `${e.clientX - r.left}px`);
        ref.current!.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={cn("spot glass rounded-2xl", className)}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function CountUp({ value, decimals = 0, suffix = "", className }: {
  value: number; decimals?: number; suffix?: string; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) =>
    v.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix,
  );
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration: 1.6, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref} className={className}>{text}</motion.span>;
}

export function ScoreRing({ score, size = 56, stroke = 4, label = true }: {
  score: number; size?: number; stroke?: number; label?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - Math.max(0.02, score)) }}
          viewport={{ once: true }}
          transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      {label && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[13px] font-semibold" style={{ color }}>
          {Math.round(score * 100)}
        </div>
      )}
    </div>
  );
}

export function ReasonChip({ r }: { r: Reason }) {
  const c = toneColor[r.tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] leading-none"
      style={{ borderColor: `color-mix(in oklab, ${c} 30%, transparent)`, color: c, background: `color-mix(in oklab, ${c} 8%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      {r.text}
    </span>
  );
}

export function Label({ name }: { name: string }) {
  const low = name.toLowerCase();
  const c = low.includes("good first") ? "var(--lime)" : low.includes("help") ? "var(--cyan)" : low.includes("bug") ? "var(--rose)" : "var(--violet)";
  return (
    <span
      className="rounded-md px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide"
      style={{ color: c, background: `color-mix(in oklab, ${c} 12%, transparent)` }}
    >
      {name}
    </span>
  );
}

// One shared 30s clock for every <Ago>. Server render (and hydration) see null, so no mismatch.
let clockNow = 0;
const clockSubs = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
function subscribeClock(cb: () => void) {
  clockSubs.add(cb);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockSubs.forEach((f) => f());
    }, 30_000);
  }
  return () => {
    clockSubs.delete(cb);
    if (!clockSubs.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/** Relative time that renders on the client only and ticks. */
export function Ago({ iso, className }: { iso: string; className?: string }) {
  const now = useSyncExternalStore(subscribeClock, () => (clockNow ||= Date.now()), () => null);
  return <span className={className}>{now ? ago(iso, now) : "…"}</span>;
}

export function Reveal({ children, delay = 0, className, y = 18 }: {
  children: ReactNode; delay?: number; className?: string; y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function SectionTitle({ kicker, title, right }: { kicker: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-cyan">
          <span className="h-px w-6 bg-cyan/70" /> {kicker}
        </div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-white md:text-3xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function Sparkline({ points, width = 120, height = 36, color = "var(--cyan)" }: {
  points: number[]; width?: number; height?: number; color?: string;
}) {
  const id = `g${useId().replace(/:/g, "")}`;
  if (points.length < 2) {
    return (
      <svg width={width} height={height}>
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 4" />
      </svg>
    );
  }
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * width, height - 3 - ((p - min) / span) * (height - 6)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.4, ease: "easeOut" }}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
      <circle cx={xy.at(-1)![0]} cy={xy.at(-1)![1]} r={2.5} fill={color} />
    </svg>
  );
}

export function Meter({ value, color = "var(--cyan)", label, display }: {
  value: number | null; color?: string; label: string; display: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-white">{display}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 40%, transparent), ${color})`, boxShadow: `0 0 12px ${color}` }}
          initial={{ width: 0 }}
          whileInView={{ width: `${Math.max(2, (value ?? 0) * 100)}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="glass grid place-items-center rounded-2xl px-6 py-16 text-center">
      <div className="mb-3 h-12 w-12 animate-spin rounded-full border-2 border-cyan/20 border-t-cyan [animation-duration:2.4s]" />
      <div className="font-display text-lg text-white">{title}</div>
      <div className="mt-1 max-w-md text-sm text-muted">{hint}</div>
    </div>
  );
}
