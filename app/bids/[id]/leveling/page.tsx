import { redirect } from "next/navigation";

// Legacy standalone leveling route — superseded by the Leveling tab on the bid detail page.
// Kept as a redirect so old bookmarks and links continue to work.
export default async function LegacyLevelingRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/bids/${id}?tab=leveling`);
}
