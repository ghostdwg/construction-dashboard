import ExternalResponsePortal from "./ExternalResponsePortal";

export const dynamic = "force-dynamic";

export default async function ExternalResponsePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ExternalResponsePortal token={token} />;
}
