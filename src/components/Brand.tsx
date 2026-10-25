import Link from "next/link";

/** Shared visible identity; storage keys keep their old names for migration. */
export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <Link href={href} className="inline-flex items-center gap-2.5 text-inherit no-underline" aria-label="RackOS home">
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="32" height="32" rx="9" fill="#D9FF70" />
      <path d="M10 7v20M24 7v20M10 10h14M10 17h14M10 24h14" stroke="#13221D" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="20.5" cy="13.5" r="1.1" fill="#13221D" />
      <circle cx="13.5" cy="20.5" r="1.1" fill="#13221D" />
    </svg>
    <span className={`font-semibold tracking-[-0.055em] ${compact ? "text-lg" : "text-xl"}`}>Rack<span className="font-normal">OS</span></span>
  </Link>;
}
