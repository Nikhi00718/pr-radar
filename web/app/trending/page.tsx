import type { Metadata } from "next";
import { RepoGrid } from "@/components/Repos";
import { Reveal, SectionTitle } from "@/components/ui";
import { getSnapshot } from "@/lib/data";

export const metadata: Metadata = { title: "Trending repos" };

export default async function TrendingPage() {
  const snap = await getSnapshot();
  return (
    <>
      <Reveal>
        <SectionTitle kicker="star growth × repo health" title={<>Trending <span className="text-muted">repos</span></>} />
      </Reveal>
      <RepoGrid repos={snap.repos} />
    </>
  );
}
