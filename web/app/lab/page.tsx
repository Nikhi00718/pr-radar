import { Brain, FlaskConical, Gauge, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { Meter, Reveal, SectionTitle, SpotCard } from "@/components/ui";
import { getModelReport, getSnapshot } from "@/lib/data";

export const metadata: Metadata = { title: "Model lab" };

const WEIGHTS: [string, number, string][] = [
  ["Outside merge rate", 0.45, "merged / closed outsider PRs, 90 days, shrunk toward 50% for small samples"],
  ["Fast first response", 0.2, "median hours to the first maintainer comment or review (log scale)"],
  ["Low PR backlog", 0.1, "open PRs older than 30 days"],
  ["Active maintainers", 0.1, "days since the last merge"],
  ["Fresh and unclaimed", 0.1, "issue age (60-day decay) and comment count"],
  ["Label bonus", 0.05, "good first issue > help wanted > bug"],
];

export default async function LabPage() {
  const [snap, report] = await Promise.all([getSnapshot(), getModelReport()]);
  const dist = [0, 0, 0, 0, 0];
  for (const o of snap.opportunities) dist[Math.min(4, Math.floor(o.score * 5))]++;
  const maxBin = Math.max(1, ...dist);

  return (
    <>
      <Reveal>
        <SectionTitle kicker={`active model · ${snap.model_version}`} title={<>Model <span className="text-muted">lab</span></>} />
      </Reveal>

      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <Reveal>
          <SpotCard className="h-full p-6">
            <div className="mb-5 flex items-center gap-2 font-display text-lg text-white">
              <Gauge className="h-5 w-5 text-cyan" /> Score v1 — the formula
            </div>
            <div className="space-y-4">
              {WEIGHTS.map(([n, w, d], i) => (
                <div key={n}>
                  <Meter label={n} value={w / 0.45} display={`${Math.round(w * 100)}%`} color={i === 0 ? "var(--lime)" : i === 1 ? "var(--cyan)" : "var(--violet)"} />
                  <div className="mt-1 text-[11.5px] text-faint">{d}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-rose/20 bg-rose/[0.05] p-3 text-[12.5px] text-rose">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Hard gates, not penalties: AI policy banned, a linked open/merged PR, or an assignee set the score to 0.
            </div>
          </SpotCard>
        </Reveal>

        <Reveal delay={0.08}>
          <SpotCard className="h-full p-6">
            <div className="mb-5 flex items-center gap-2 font-display text-lg text-white">
              <FlaskConical className="h-5 w-5 text-violet" /> Live score distribution
            </div>
            <div className="flex h-48 items-end gap-3">
              {dist.map((n, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <span className="font-mono text-[11px] text-muted">{n}</span>
                  <div
                    className="w-full origin-bottom rounded-t-lg"
                    style={{
                      height: `${(n / maxBin) * 140 + 4}px`,
                      background: `linear-gradient(to top, color-mix(in oklab, var(--violet) 25%, transparent), ${i >= 3 ? "var(--lime)" : i === 2 ? "var(--cyan)" : "var(--violet)"})`,
                      boxShadow: i >= 3 ? "0 0 24px -4px var(--lime)" : undefined,
                    }}
                  />
                  <span className="font-mono text-[10.5px] text-faint">{i * 20}-{i * 20 + 20}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[13px] leading-relaxed text-muted">
              {snap.stats.opportunities} scored issues with a non-zero score; {snap.stats.blocked} more are gated (claimed, assigned, or banned).
            </p>
          </SpotCard>
        </Reveal>
      </div>

      <Reveal>
        <SpotCard className="p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-2 font-display text-lg text-white">
            <Brain className="h-5 w-5 text-lime" /> Merge-probability model (LightGBM)
          </div>
          {report ? (
            <div className="grid gap-8 md:grid-cols-[1fr_1.2fr]">
              <div className="space-y-5">
                <Meter label="AUC · full model (PR size, author history)" value={report.auc_full} display={report.auc_full.toFixed(3)} color="var(--cyan)" />
                <Meter label="AUC · live model (repo signals only)" value={report.auc_model} display={report.auc_model.toFixed(3)} color="var(--lime)" />
                <Meter label="AUC · score v1 formula" value={report.auc_v1} display={report.auc_v1.toFixed(3)} color="var(--violet)" />
                <div className="space-y-1 font-mono text-[11.5px] leading-relaxed text-muted">
                  <div>{report.rows.toLocaleString()} outsider PRs · {report.repos} repos · test {report.test_rows.toLocaleString()}</div>
                  <div>label: {report.label} · base rate {Math.round(report.base_rate * 100)}%</div>
                  <div>{report.split}</div>
                </div>
                <p className="text-[12.5px] leading-relaxed text-faint">
                  Only the live model can rank issues (no PR exists yet), so it is the one compared against v1. It ships only if it beats v1 by 0.02 AUC.
                </p>
                <div className={`inline-flex rounded-lg px-3 py-1.5 font-mono text-[12px] ${report.decision === "ship" ? "bg-lime/15 text-lime" : "bg-amber/15 text-amber"}`}>
                  decision: {report.decision === "ship" ? "ship the model" : "keep score v1"}
                </div>
              </div>
              <div>
                <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.2em] text-faint">top features by gain</div>
                <div className="space-y-3">
                  {report.top_features.slice(0, 8).map((f) => (
                    <Meter key={f.name} label={f.name} value={f.gain / report.top_features[0].gain} display={f.gain.toFixed(0)} color="var(--cyan)" />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <p className="text-[14px] leading-relaxed text-muted">
                Not trained yet. The pipeline pulls a year of outsider PRs from the public ClickHouse GitHub dataset, builds
                features known at the moment each PR was opened, splits train/test by time, and compares AUC against score
                v1. The model replaces v1 only if it clearly wins.
              </p>
              <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-cyan">
{`cd collector
uv sync --extra ml
uv run python -m ml.build_dataset
uv run python -m ml.train`}
              </pre>
            </div>
          )}
        </SpotCard>
      </Reveal>
    </>
  );
}
