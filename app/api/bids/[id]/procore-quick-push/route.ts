// POST /api/bids/[id]/procore-quick-push
//
// Orchestrates the 7-step Procore Quick Push and streams progress as SSE.
// Body: { confirm: true }
//
// SSE event stream:
//   event: step     — data: SseStepEvent (emitted twice per step: running, then terminal)
//   event: complete — data: SseCompleteEvent
//   event: failed   — data: SseFailedEvent
//
// 4xx errors are returned as JSON before the stream opens.

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProcoreCreds } from "@/lib/services/procore/client";
import { runQuickPush } from "@/lib/services/procore/quickPushService";
import type { SseStepEvent, SseCompleteEvent, SseFailedEvent } from "@/lib/services/procore/quickPushTypes";

const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!AUTH_DISABLED) {
    const session = await auth();
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, status: true },
  });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!(body instanceof Object) || (body as Record<string, unknown>).confirm !== true) {
    return Response.json({ error: "Confirmation required" }, { status: 400 });
  }

  if (bid.status === "lost" || bid.status === "cancelled") {
    return Response.json(
      { error: `This bid is marked ${bid.status} and cannot be awarded.` },
      { status: 400 }
    );
  }

  try {
    await getProcoreCreds();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Procore not configured";
    return Response.json({ error: message }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (
        event: string,
        data: SseStepEvent | SseCompleteEvent | SseFailedEvent
      ) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // client disconnected — ignore
        }
      };

      try {
        await runQuickPush(bidId, prisma, emit);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
