import type { Metadata } from "next";
import OpportunityBoard from "@/components/OpportunityBoard";
import { Reveal, SectionTitle } from "@/components/ui";
import { getSnapshot } from "@/lib/data";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const snap = await getSnapshot();
  return (
    <>
      <Reveal>
        <SectionTitle
          kicker={`${snap.stats.opportunities} live · ${snap.stats.blocked} claimed or blocked`}
          title={<>Opportunities <span className="text-muted">ranked by merge odds</span></>}
        />
      </Reveal>
      <OpportunityBoard items={snap.opportunities} blocked={snap.blocked} />
    </>
  );
}
