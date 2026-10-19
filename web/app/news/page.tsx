import type { Metadata } from "next";
import { NewsFeed } from "@/components/News";
import { Reveal, SectionTitle } from "@/components/ui";
import { getSnapshot } from "@/lib/data";

export const metadata: Metadata = { title: "Signals" };

export default async function NewsPage() {
  const snap = await getSnapshot();
  return (
    <>
      <Reveal>
        <SectionTitle
          kicker="hacker news · releases · last 7 days"
          title={<>Signals <span className="text-muted">from the wire</span></>}
        />
      </Reveal>
      <NewsFeed items={snap.news} />
    </>
  );
}
