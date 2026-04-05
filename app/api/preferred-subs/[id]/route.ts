import { prisma } from "@/lib/prisma";

// DELETE /api/preferred-subs/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (isNaN(recordId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  try {
    await prisma.preferredSub.delete({ where: { id: recordId } });
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/preferred-subs/:id] error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
