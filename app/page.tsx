import Link from "next/link";

const CAPABILITIES = [
  ["Bid intelligence", "Move opportunities from pursuit through award with an accountable project record."],
  ["Field operations", "Turn meetings and field evidence into traceable actions, decisions, and responses."],
  ["Controlled delivery", "Keep every external response tied to its package, author, evidence, and disposition."],
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-dvh" data-testid="public-landing">
      <header className="flex h-[60px] items-center justify-between border-b border-[var(--line)] px-6">
        <span className="font-mono text-[13px] tracking-[0.08em] text-[var(--text-dim)]">
          NEURO | GLITCH · GroundWorX
        </span>
        <Link href="/login" className="btn-ghost text-[14px]">Login →</Link>
      </header>
      <section className="blueprint-grid flex min-h-[68vh] items-center justify-center px-6 py-20 text-center">
        <div className="max-w-[720px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--signal)]">
            Construction Intelligence Platform
          </p>
          <h1 className="mt-4 text-[52px] font-extrabold leading-none tracking-[-0.05em] md:text-[76px]">
            GroundWorX
          </h1>
          <p className="mt-5 text-[22px] text-[var(--text-soft)]">From bid to closeout.</p>
          <Link href="/login" className="btn-primary mt-10 inline-flex px-8 py-3.5 text-[16px]">
            Login to GroundWorX →
          </Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-[960px] grid-cols-1 gap-6 px-6 py-16 md:grid-cols-3">
        {CAPABILITIES.map(([title, body]) => (
          <article key={title} className="card-base p-6">
            <h2 className="text-[18px] font-semibold">{title}</h2>
            <p className="mt-2 text-[14px] leading-6 text-[var(--text-soft)]">{body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
