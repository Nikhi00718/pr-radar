"use client";

import { useEffect, useRef } from "react";

/** Fixed, full-screen backdrop: aurora glows, a moving perspective grid and a reactive particle field. */
export default function Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const mouse = { x: -9999, y: -9999 };
    type P = { x: number; y: number; vx: number; vy: number; r: number; hue: number };
    let ps: P[] = [];

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(110, Math.floor((w * h) / 16000));
      ps = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 0.3,
        hue: Math.random() < 0.7 ? 190 : 258,
      }));
    };

    const step = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 160 * 160) {
          // gentle swirl around the cursor
          const f = (1 - Math.sqrt(d2) / 160) * 0.012;
          p.vx += -dy * f * 0.05 + dx * f * 0.01;
          p.vy += dx * f * 0.05 + dy * f * 0.01;
        }
        p.vx *= 0.985; p.vy *= 0.985;
        p.vx += (Math.random() - 0.5) * 0.008; p.vy += (Math.random() - 0.5) * 0.008;
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
      }
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120) {
            const o = (1 - Math.sqrt(d2) / 120) * 0.14;
            ctx.strokeStyle = `hsla(${a.hue}, 100%, 70%, ${o})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of ps) {
        const near = Math.hypot(mouse.x - p.x, mouse.y - p.y) < 140;
        ctx.fillStyle = `hsla(${p.hue}, 100%, ${near ? 85 : 72}%, ${near ? 0.95 : 0.55})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (near ? 1.8 : 1), 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(step);
    };

    resize();
    if (reduced) step(); else raf = requestAnimationFrame(step);
    if (reduced) cancelAnimationFrame(raf);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#0b1030_0%,var(--bg)_60%)]" />
      <div className="aurora left-[-10%] top-[-20%] h-[60vh] w-[60vw] bg-[radial-gradient(circle,#1fb6ff_0%,transparent_60%)]" />
      <div
        className="aurora right-[-15%] top-[10%] h-[55vh] w-[50vw] bg-[radial-gradient(circle,#7b4dff_0%,transparent_60%)]"
        style={{ animationDelay: "-8s", animationDuration: "28s" }}
      />
      <div
        className="aurora bottom-[-25%] left-[20%] h-[50vh] w-[60vw] bg-[radial-gradient(circle,#00ffa3_0%,transparent_60%)] opacity-20"
        style={{ animationDelay: "-14s", animationDuration: "34s" }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[55vh] overflow-hidden opacity-70">
        <div className="grid-floor" />
      </div>
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(4,5,10,0.85)_100%)]" />
    </div>
  );
}
