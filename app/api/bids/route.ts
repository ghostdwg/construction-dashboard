import { prisma } from "@/lib/prisma";

export async function GET() {
  const bids = await prisma.bid.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json(bids);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { projectName, location, description, dueDate } = body;

  if (!projectName) {
    return Response.json({ error: "projectName is required" }, { status: 400 });
  }

  const bid = await prisma.bid.create({
    data: {
      projectName,
      location: location || null,
      description: description || null,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });

  return Response.json(bid, { status: 201 });
}
