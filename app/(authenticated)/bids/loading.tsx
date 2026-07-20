// Skeleton loading UI for the bids list page (Next.js App Router automatic Suspense).
// Shown while the server component fetches from Prisma on first load.

export default function BidsLoading() {
  return (
    <div className="space-y-6">
      {/* Metric cards skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius)] border border-[var(--line)] px-4 py-4 space-y-3"
            style={{ background: "rgba(15,22,40,0.96)" }}
          >
            <div className="skeleton h-2.5 w-20" />
            <div className="skeleton h-9 w-14" />
            <div className="skeleton h-2 w-24" />
          </div>
        ))}
      </div>

      {/* Bids table skeleton */}
      <div
        className="rounded-[var(--radius)] border border-[var(--line)] overflow-hidden"
        style={{ background: "rgba(15,22,40,0.96)" }}
      >
        {/* Header row */}
        <div className="flex gap-4 border-b border-[var(--line)] px-4 py-3">
          {[120, 80, 60, 80, 70, 60].map((w, i) => (
            <div key={i} className="skeleton h-2.5" style={{ width: w }} />
          ))}
        </div>

        {/* Bid rows */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-[var(--line)] px-4 py-3 last:border-b-0"
          >
            <div className="skeleton h-4 w-48" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-5 w-16 rounded-full" />
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
