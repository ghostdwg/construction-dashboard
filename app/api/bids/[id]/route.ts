import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { recalculateSchedule } from "@/lib/services/schedule/scheduleService";

// Module INT1 — valid enum-string values for intake fields
const VALID_DELIVERY_METHODS = ["HARD_BID", "DESIGN_BUILD", "CM_AT_RISK", "NEGOTIATED"];
const VALID_OWNER_TYPES = ["PUBLIC_ENTITY", "PRIVATE_OWNER", "DEVELOPER", "INSTITUTIONAL"];

function validateIntakeFields(body: Record<string, unknown>): string | null {
  if (body.deliveryMethod !== undefined && body.deliveryMethod !== null && body.deliveryMethod !== "") {
    if (!VALID_DELIVERY_METHODS.includes(String(body.deliveryMethod))) {
      return `deliveryMethod must be one of: ${VALID_DELIVERY_METHODS.join(", ")}`;
    }
  }
  if (body.ownerType !== undefined && body.ownerType !== null && body.ownerType !== "") {
    if (!VALID_OWNER_TYPES.includes(String(body.ownerType))) {
      return `ownerType must be one of: ${VALID_OWNER_TYPES.join(", ")}`;
    }
  }
  for (const f of ["approxSqft", "stories"] as const) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        return `${f} must be a non-negative integer`;
      }
    }
  }
  for (const f of ["ldAmountPerDay", "ldCapAmount", "dbeGoalPercent"] as const) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) {
        return `${f} must be a non-negative number`;
      }
    }
  }
  if (body.dbeGoalPercent !== undefined && body.dbeGoalPercent !== null && body.dbeGoalPercent !== "") {
    const n = Number(body.dbeGoalPercent);
    if (n > 100) return "dbeGoalPercent must be 0–100";
  }
  return null;
}

// Coerce empty strings → null and apply only the intake fields that were
// present in the body (so PATCH semantics stay intact).
function buildIntakeUpdateData(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const setStr = (key: string) => {
    if (body[key] === undefined) return;
    const v = body[key];
    data[key] = v === "" || v === null ? null : String(v);
  };
  const setInt = (key: string) => {
    if (body[key] === undefined) return;
    const v = body[key];
    data[key] = v === "" || v === null ? null : Math.trunc(Number(v));
  };
  const setFloat = (key: string) => {
    if (body[key] === undefined) return;
    const v = body[key];
    data[key] = v === "" || v === null ? null : Number(v);
  };
  const setBool = (key: string) => {
    if (body[key] === undefined) return;
    data[key] = Boolean(body[key]);
  };
  setStr("deliveryMethod");
  setStr("ownerType");
  setStr("buildingType");
  setInt("approxSqft");
  setInt("stories");
  setFloat("ldAmountPerDay");
  setFloat("ldCapAmount");
  setFloat("dbeGoalPercent");
  setBool("occupiedSpace");
  setBool("phasingRequired");
  setStr("siteConstraints");
  setStr("estimatorNotes");
  setStr("scopeBoundaryNotes");
  setBool("veInterest");
  // H4 — construction start date
  if (body.constructionStartDate !== undefined) {
    const v = body.constructionStartDate;
    data.constructionStartDate =
      v === "" || v === null ? null : new Date(String(v));
  }
  return data;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      bidTrades: { include: { trade: true }, orderBy: { id: "asc" } },
      selections: { include: { subcontractor: true } },
    },
  });

  if (!bid) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(bid);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { projectName, location, description, status, dueDate, projectType } = body;

  // INT1 — validate intake fields if any present
  const validationError = validateIntakeFields(body);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  if (projectType !== undefined && !["PUBLIC", "PRIVATE", "NEGOTIATED"].includes(projectType)) {
    return Response.json(
      { error: "projectType must be PUBLIC, PRIVATE, or NEGOTIATED" },
      { status: 400 }
    );
  }

  const intakeData = buildIntakeUpdateData(body);

  try {
    const bid = await prisma.bid.update({
      where: { id: bidId },
      data: {
        ...(projectName !== undefined ? { projectName } : {}),
        ...(location !== undefined ? { location: location || null } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(projectType !== undefined ? { projectType } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...intakeData,
      },
    });

    // H4 — if the construction start date changed, recalculate the schedule
    // so all start/finish dates hydrate from the new anchor.
    if ("constructionStartDate" in intakeData) {
      try {
        await recalculateSchedule(bidId);
      } catch (recErr) {
        // Don't fail the bid update if recalculation has issues; log and continue
        console.error("[PATCH /api/bids/:id] schedule recalc failed", recErr);
      }
    }

    return Response.json(bid);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
