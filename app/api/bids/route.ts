import { prisma } from "@/lib/prisma";
import { autoPopulateBidSubs } from "@/lib/services/autoPopulateBidSubs";

const VALID_PROJECT_TYPES = ["PUBLIC", "PRIVATE", "NEGOTIATED"];
const VALID_DELIVERY_METHODS = ["HARD_BID", "DESIGN_BUILD", "CM_AT_RISK", "NEGOTIATED"];
const VALID_OWNER_TYPES = ["PUBLIC_ENTITY", "PRIVATE_OWNER", "DEVELOPER", "INSTITUTIONAL"];

export async function GET() {
  const bids = await prisma.bid.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json(bids);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { projectName, location, description, dueDate, projectType, deliveryMethod, ownerType } = body;

  if (!projectName) {
    return Response.json({ error: "projectName is required" }, { status: 400 });
  }

  if (projectType !== undefined && projectType !== null && projectType !== "" && !VALID_PROJECT_TYPES.includes(projectType)) {
    return Response.json(
      { error: `projectType must be one of: ${VALID_PROJECT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (deliveryMethod !== undefined && deliveryMethod !== null && deliveryMethod !== "" && !VALID_DELIVERY_METHODS.includes(deliveryMethod)) {
    return Response.json(
      { error: `deliveryMethod must be one of: ${VALID_DELIVERY_METHODS.join(", ")}` },
      { status: 400 }
    );
  }
  if (ownerType !== undefined && ownerType !== null && ownerType !== "" && !VALID_OWNER_TYPES.includes(ownerType)) {
    return Response.json(
      { error: `ownerType must be one of: ${VALID_OWNER_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const bid = await prisma.bid.create({
    data: {
      projectName,
      location: location || null,
      description: description || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      ...(projectType ? { projectType } : {}),
      ...(deliveryMethod ? { deliveryMethod } : {}),
      ...(ownerType ? { ownerType } : {}),
    },
  });

  await autoPopulateBidSubs(bid.id);

  return Response.json(bid, { status: 201 });
}
