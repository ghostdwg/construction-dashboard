import Link from "next/link";

export default async function BidsPage() {
  const res = await fetch("/api/bids", { cache: "no-store" });

  if (!res.ok) {
    throw new Error("Failed to fetch bids");
  }

  const bids = await res.json();

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Bids</h1>
        <Link
          href="/bids/new"
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700"
        >
          New Bid
        </Link>
      </div>

      {bids.length === 0 ? (
        <p className="text-zinc-500 text-sm">No bids yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 border border-zinc-200 rounded-md">
          {bids.map((bid: { id: number; projectName: string; location?: string; dueDate?: string }) => (
            <li key={bid.id} className="flex flex-col gap-1 px-4 py-3">
              <span className="font-medium">{bid.projectName}</span>
              {bid.location && (
                <span className="text-sm text-zinc-500">{bid.location}</span>
              )}
              {bid.dueDate && (
                <span className="text-xs text-zinc-400">
                  Due: {new Date(bid.dueDate).toLocaleDateString()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
