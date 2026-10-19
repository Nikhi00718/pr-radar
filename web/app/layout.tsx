import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Background from "@/components/Background";
import Shell, { type PaletteItem } from "@/components/Shell";
import { getSnapshot } from "@/lib/data";
import "./globals.css";

const sans = Inter({ variable: "--font-sans-face", subsets: ["latin"] });
const display = Space_Grotesk({ variable: "--font-display-face", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PR Radar", template: "%s · PR Radar" },
  description: "Open-source issues where an outside PR is likely to get merged — ranked, explained, and pushed to your phone.",
};

export const viewport: Viewport = { themeColor: "#04050a" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const snap = await getSnapshot();
  const index: PaletteItem[] = [
    ...snap.repos.map((r) => ({
      kind: "repo" as const,
      title: r.full_name,
      sub: r.description || r.language || "repository",
      href: `/repo/${r.full_name}`,
      score: r.score,
    })),
    ...snap.opportunities.slice(0, 200).map((o) => ({
      kind: "issue" as const,
      title: o.title,
      sub: `${o.repo}#${o.number}`,
      href: o.url,
      external: true,
      score: o.score,
    })),
  ];

  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Background />
        <div className="noise" aria-hidden />
        <div className="scanline" aria-hidden />
        <Shell generatedAt={snap.generated_at} feedback={snap.feedback} index={index}>
          <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-28 sm:px-6">{children}</main>
          <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-8 font-mono text-[11px] text-faint sm:px-6">
            <span>PR·RADAR — score {snap.model_version}</span>
            <span>
              {snap.stats.repos} repos · {snap.stats.issues} issues · {snap.stats.news} signals tracked
            </span>
          </footer>
        </Shell>
      </body>
    </html>
  );
}
