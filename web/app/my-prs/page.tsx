import type { Metadata } from "next";
import { MyPrList, MyPrStats, MyRepos } from "@/components/MyPrs";
import { Empty, Reveal, SectionTitle } from "@/components/ui";
import { getSnapshot } from "@/lib/data";

export const metadata: Metadata = { title: "My PRs" };

export default async function MyPrsPage() {
  const snap = await getSnapshot();
  const data = snap.my_prs;
  if (!data) {
    return (
      <Empty
        title="No PR history in this snapshot"
        hint="The next collector run adds it (the my_prs step needs a GitHub token)."
      />
    );
  }
  return (
    <>
      <Reveal>
        <SectionTitle
          kicker={`@${data.login} · ${snap.stats.boosted ?? 0} live issues boosted by your history`}
          title={<>My PRs <span className="text-muted">and where they land</span></>}
        />
      </Reveal>
      <MyPrStats data={data} />
      <Reveal>
        <MyRepos data={data} />
      </Reveal>
      <MyPrList prs={data.prs} />
    </>
  );
}
