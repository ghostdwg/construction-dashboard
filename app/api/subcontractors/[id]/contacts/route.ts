import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subId = parseInt(id, 10);

  if (isNaN(subId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { name, email, phone, title, isPrimary } = body;

  if (!name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  // If this contact is primary, clear existing primary
  if (isPrimary) {
    await prisma.contact.updateMany({
      where: { subcontractorId: subId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const contact = await prisma.contact.create({
    data: {
      subcontractorId: subId,
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      title: title?.trim() || null,
      isPrimary: !!isPrimary,
    },
  });

  return Response.json(contact, { status: 201 });
}
