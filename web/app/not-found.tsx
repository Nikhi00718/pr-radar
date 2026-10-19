import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <div className="text-gradient font-display text-8xl font-semibold">404</div>
        <p className="mt-3 text-muted">Nothing on this frequency. The repo may not be tracked yet.</p>
        <Link href="/" className="mt-6 inline-block rounded-xl border border-cyan/40 px-5 py-2.5 text-sm text-cyan hover:text-white">
          Back to the radar
        </Link>
      </div>
    </div>
  );
}
