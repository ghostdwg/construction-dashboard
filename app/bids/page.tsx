import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewBidButton from "./NewBidButton";

export default async function BidsPage() {
  const bids = await prisma.bid.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Bids</h1>
        <NewBidButton />
      </div>

      {bids.length === 0 ? (
        <p className="text-zinc-500 text-sm">No bids yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 border border-zinc-200 rounded-md">
          {bids.map((bid) => (
            <li key={bid.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{bid.projectName}</span>
                <div className="flex gap-3 text-xs text-zinc-400">
                  {bid.location && <span>{bid.location}</span>}
                  {bid.dueDate && (
                    <span>Due: {new Date(bid.dueDate).toLocaleDateString()}</span>
                  )}
                  <span className="capitalize">{bid.status}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/bids/${bid.id}`}
                  className="text-sm text-zinc-500 hover:underline"
                >
                  View →
                </Link>
                <Link
                  href={`/bids/${bid.id}/leveling`}
                  className="text-sm text-zinc-500 hover:underline"
                >
                  Level →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
