"use client";

import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { compact } from "@/lib/format";

export default function StarChart({ history }: { history: [string, number][] }) {
  const W = 800, H = 260, P = { l: 48, r: 16, t: 16, b: 28 };
  const ref = useRef<SVGSVGElement>(null);
  const [hi, setHi] = useState<number | null>(null);

  const pts = useMemo(() => {
    if (history.length < 2) return null;
    const ts = history.map(([t]) => Date.parse(t));
    const vs = history.map(([, v]) => v);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    const v0 = Math.min(...vs), v1 = Math.max(...vs);
    const pad = (v1 - v0) * 0.1 || 1;
    const x = (t: number) => P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
    const y = (v: number) => P.t + (1 - (v - (v0 - pad)) / (v1 + pad - (v0 - pad))) * (H - P.t - P.b);
    const xy = history.map(([t, v]) => ({ x: x(Date.parse(t)), y: y(v), t, v }));
    const ticks = Array.from({ length: 4 }, (_, i) => {
      const v = v0 - pad + ((v1 + pad - (v0 - pad)) * i) / 3;
      return { y: y(v), label: compact(Math.round(v)) };
    });
    return { xy, ticks };
  }, [history, P.b, P.l, P.r, P.t]);

  if (!pts) {
    return (
      <div className="grid h-[260px] place-items-center rounded-xl border border-dashed border-white/10 text-sm text-muted">
        One snapshot so far. The star chart fills in as the collector keeps running.
      </div>
    );
  }
  const d = pts.xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const h = hi != null ? pts.xy[hi] : null;

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        onPointerMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          pts.xy.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(pts.xy[best].x - x)) best = i; });
          setHi(best);
        }}
        onPointerLeave={() => setHi(null)}
      >
        <defs>
          <linearGradient id="star-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2ee6ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#9d7bff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="star-line" x1="0" x2="1">
            <stop offset="0%" stopColor="#9d7bff" />
            <stop offset="100%" stopColor="#2ee6ff" />
          </linearGradient>
        </defs>
        {pts.ticks.map((t) => (
          <g key={t.y}>
            <line x1={P.l} x2={W - P.r} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 5" />
            <text x={P.l - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#545b74" fontFamily="var(--font-mono-face)">{t.label}</text>
          </g>
        ))}
        <motion.path
          d={`${d} L${pts.xy.at(-1)!.x},${H - P.b} L${pts.xy[0].x},${H - P.b} Z`}
          fill="url(#star-fill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 1 }}
        />
        <motion.path
          d={d}
          fill="none"
          stroke="url(#star-line)"
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: "drop-shadow(0 0 6px rgba(46,230,255,0.6))" }}
        />
        {h && (
          <g>
            <line x1={h.x} x2={h.x} y1={P.t} y2={H - P.b} stroke="rgba(46,230,255,0.4)" />
            <circle cx={h.x} cy={h.y} r={5} fill="#04050a" stroke="#2ee6ff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="glass pointer-events-none absolute top-2 rounded-lg px-2.5 py-1.5 font-mono text-[11px]"
          style={{ left: `clamp(0px, calc(${(h.x / W) * 100}% - 70px), calc(100% - 140px))` }}
        >
          <div className="text-white">{h.v.toLocaleString()} ★</div>
          <div className="text-faint">{new Date(h.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        </div>
      )}
    </div>
  );
}
