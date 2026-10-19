import { ArrowLeft, ExternalLink, GitFork, Quote, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import OpportunityCard from "@/components/OpportunityCard";
import { HealthBadges } from "@/components/Repos";
import StarChart from "@/components/StarChart";
import { Meter, ReasonChip, Reveal, ScoreRing, SectionTitle } from "@/components/ui";
import { getSnapshot } from "@/lib/data";
import { compact, hours, langColor, pct } from "@/lib/format";

type Params = { owner: string; name: string };
const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;
const valid = (p: Params) => SEGMENT.test(p.owner) && SEGMENT.test(p.name);

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  return { title: valid(p) ? `${p.owner}/${p.name}` : "Not found" };
}

export async function generateStaticParams(): Promise<Params[]> {
  const snap = await getSnapshot();
  const top = snap.repos.slice(0, 40).map((r) => {
    const [owner, name] = r.full_name.split("/");
    return { owner, name };
  });
  return top.length ? top : [{ owner: "vllm-project", name: "vllm" }];
}

export default function RepoPage({ params }: { params: Promise<Params> }) {
  return (
    <Suspense fallback={<div className="shimmer h-[70vh] rounded-3xl" />}>
      <RepoDetail params={params} />
    </Suspense>
  );
}

async function RepoDetail({ params }: { params: Promise<Params> }) {
  const { owner, name } = await params;
  if (!valid({ owner, name })) notFound();
  const full = `${owner}/${name}`.toLowerCase();
  const snap = await getSnapshot();
  const r = snap.repos.find((x) => x.full_name.toLowerCase() === full);
  if (!r) notFound();
  const issues = [...snap.opportunities, ...snap.blocked].filter((o) => o.repo_id === r.id);
  const s = r.signals;
  const closed = s?.outside_prs_closed_90d ?? 0;
  const merged = s?.outside_prs_merged_90d ?? 0;

  return (
    <>
      <Link href="/trending" className="mb-6 inline-flex items-center gap-1.5 font-mono text-[12px] text-muted hover:text-cyan">
        <ArrowLeft className="h-3.5 w-3.5" /> trending
      </Link>

      <Reveal>
        <section className="glass relative mb-8 overflow-hidden rounded-3xl p-6 sm:p-8">
          <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: `color-mix(in oklab, ${langColor(r.language)} 25%, transparent)` }} />
          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-faint">
                <span className="h-2 w-2 rounded-full" style={{ background: langColor(r.language) }} />
                {r.language ?? "—"} · {r.source === "search" ? "new this month" : r.source}
              </div>
              <ViewTransition name={`repo-${r.id}`} share="morph" default="none">
                <h1 className="break-words font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">{r.full_name}</h1>
              </ViewTransition>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{r.description}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {r.topics.slice(0, 8).map((t) => (
                  <span key={t} className="rounded-full bg-cyan/[0.08] px-2.5 py-0.5 font-mono text-[11px] text-cyan">{t}</span>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-5 font-mono text-[13px] text-muted">
                <span className="inline-flex items-center gap-1.5"><Star className="h-4 w-4 text-amber" />{r.stars.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1.5"><GitFork className="h-4 w-4" />{compact(r.forks)}</span>
                {r.velocity != null && <span className="text-lime">+{compact(r.velocity)} ★/day</span>}
                <a href={`https://github.com/${r.full_name}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan hover:text-white">
                  GitHub <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <ScoreRing score={r.score} size={112} stroke={7} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">repo score</span>
            </div>
          </div>
          <div className="relative mt-6 flex flex-wrap gap-1.5">
            {r.reasons.map((x) => <ReasonChip key={x.text} r={x} />)}
          </div>
        </section>
      </Reveal>

      <div className="mb-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Reveal>
          <div className="glass rounded-2xl p-5">
            <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.2em] text-cyan">stars · last 30 days of snapshots</div>
            <StarChart history={r.history} />
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="glass h-full rounded-2xl p-5">
            <div className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.2em] text-cyan">health · last 90 days</div>
            {s ? (
              <div className="space-y-4">
                <Meter label="Outsider PRs merged" value={closed ? merged / closed : 0} display={closed ? `${merged}/${closed}` : "n/a"} color="var(--lime)" />
                <Meter
                  label="First maintainer reply"
                  value={s.median_first_response_h == null ? 0 : Math.max(0.03, 1 - Math.log1p(s.median_first_response_h) / Math.log1p(336))}
                  display={hours(s.median_first_response_h)}
                  color="var(--cyan)"
                />
                <Meter label="Main-branch CI green" value={s.ci_pass_rate} display={pct(s.ci_pass_rate)} color="var(--violet)" />
                <Meter
                  label="Activity (days since merge)"
                  value={s.days_since_maintainer_merge == null ? 0 : Math.max(0.03, 1 - s.days_since_maintainer_merge / 45)}
                  display={s.days_since_maintainer_merge == null ? "—" : `${Math.round(s.days_since_maintainer_merge)}d`}
                  color="var(--amber)"
                />
                <HealthBadges r={r} />
                {s.ai_policy_evidence && (
                  <blockquote className="relative mt-2 rounded-xl border border-white/[0.06] bg-black/25 p-3 pl-9 text-[12.5px] italic leading-relaxed text-muted">
                    <Quote className="absolute left-3 top-3 h-4 w-4 text-faint" />
                    {s.ai_policy_evidence}
                  </blockquote>
                )}
                {!s.has_contributing && <div className="text-[12px] text-amber">No CONTRIBUTING file found.</div>}
              </div>
            ) : (
              <div className="text-sm text-muted">Signals not computed yet for this repo.</div>
            )}
          </div>
        </Reveal>
      </div>

      <SectionTitle kicker={`${issues.length} tracked issues`} title="Open issues" />
      <div className="grid gap-3">
        {issues.length ? (
          issues.slice(0, 30).map((o, i) => (
            <Reveal key={o.id} delay={Math.min(i, 6) * 0.04}>
              <OpportunityCard o={o} rank={i + 1} />
            </Reveal>
          ))
        ) : (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted">
            No labelled issues tracked here yet (good first issue, help wanted, bug).
          </div>
        )}
      </div>
    </>
  );
}
