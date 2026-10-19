import { ArrowRight } from "lucide-react";
import Link from "next/link";
import Hero from "@/components/Hero";
import { Ticker } from "@/components/News";
import OpportunityCard from "@/components/OpportunityCard";
import { RepoTile } from "@/components/Repos";
import { Empty, Reveal, SectionTitle } from "@/components/ui";
import { getSnapshot } from "@/lib/data";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

export default async function Home() {
  const snap = await getSnapshot();
  const visible = snap.opportunities.filter((o) => !o.hidden);
  const rising = snap.repos
    .filter((r) => !r.hidden && r.velocity != null)
    .sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0))
    .slice(0, 6);
  const replies = snap.repos.map((r) => r.signals?.median_first_response_h).filter((h): h is number => h != null);

  return (
    <>
      <Hero
        items={visible}
        stats={{
          hot: snap.stats.hot,
          opportunities: snap.stats.opportunities,
          repos: snap.stats.repos,
          medianReply: median(replies),
          banned: snap.stats.ai_banned_repos,
        }}
      />

      <Reveal className="mb-20">
        <Ticker items={snap.news} />
      </Reveal>

      <section className="mb-20">
        <Reveal>
          <SectionTitle
            kicker="top picks"
            title={<>Best bets <span className="text-muted">right now</span></>}
            right={
              <Link href="/opportunities" className="group inline-flex items-center gap-1.5 text-sm text-cyan hover:text-white">
                All {snap.stats.opportunities} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            }
          />
        </Reveal>
        {visible.length === 0 ? (
          <Empty
            title="Scope is empty"
            hint={<>Run <code className="text-cyan">uv run radar run</code> in <code>collector/</code> to start the first scan.</>}
          />
        ) : (
          <div className="grid gap-3">
            {visible.slice(0, 6).map((o, i) => (
              <Reveal key={o.id} delay={i * 0.05}>
                <OpportunityCard o={o} rank={i + 1} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section className="mb-20">
        <Reveal>
          <SectionTitle
            kicker="star velocity"
            title={<>Rising <span className="text-muted">fastest</span></>}
            right={
              <Link href="/trending" className="group inline-flex items-center gap-1.5 text-sm text-cyan hover:text-white">
                All trending <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            }
          />
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rising.map((r, i) => (
            <Reveal key={r.id} delay={i * 0.06}>
              <RepoTile r={r} i={i} />
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal>
        <section className="glass relative overflow-hidden rounded-3xl p-6 sm:p-10">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet/20 blur-3xl" />
          <SectionTitle kicker="how it ranks" title="Every score comes with its reasons" />
          <div className="grid gap-6 md:grid-cols-3">
            {[
              ["45%", "Outside merge rate", "Share of PRs from non-members merged in the last 90 days. The strongest single signal."],
              ["20%", "First reply speed", "Median hours until a maintainer comments on or reviews an outsider PR."],
              ["35%", "Backlog, activity, freshness", "Stale PR pile, days since the last merge, issue age and comments, label hints."],
            ].map(([w, t, d]) => (
              <div key={t} className="relative">
                <div className="text-gradient font-mono text-4xl font-semibold">{w}</div>
                <div className="mt-2 font-display text-lg text-white">{t}</div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 border-t border-white/[0.06] pt-5 text-sm text-muted">
            Hard filters force the score to zero: the repo bans AI-assisted PRs, a linked PR already exists, or someone is
            assigned. <Link href="/lab" className="text-cyan hover:text-white">Open the model lab →</Link>
          </p>
        </section>
      </Reveal>
    </>
  );
}
