// POST /api/bids/[id]/schedule/export
//
// Generates a Microsoft Project-compatible CSV for the schedule. Column
// headers match MSP's default import mapping so the PM can drag-import
// into their project file on day 1.
//
// Columns: ID, Task Name, Duration, Start, Finish, Predecessors, Resource Names, Notes
//
// Duration is emitted as "Nd" (e.g. "15d") which MSP recognizes as working
// days. Dates are emitted in MM/DD/YYYY format (MSP's US default).

import { loadScheduleForBid } from "@/lib/services/schedule/scheduleService";

// ── CSV helpers ─────────────────────────────────────────────────────────────

function csvEscape(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(values: Array<string | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

function fmtMspDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const { activities } = await loadScheduleForBid(bidId);

    const header = [
      "ID",
      "Task Name",
      "Duration",
      "Start",
      "Finish",
      "Predecessors",
      "Resource Names",
      "Notes",
    ];
    const rows = [toCsvRow(header)];

    for (const a of activities) {
      const durationStr = a.kind === "MILESTONE" ? "0d" : `${a.durationDays}d`;
      rows.push(
        toCsvRow([
          a.activityId,
          a.name,
          durationStr,
          fmtMspDate(a.startDate),
          fmtMspDate(a.finishDate),
          a.predecessorIds.join(","),
          a.tradeName ?? "",
          a.notes,
        ])
      );
    }

    const csv = rows.join("\r\n") + "\r\n";
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Schedule_Bid${bidId}_${dateStr}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[POST /api/bids/:id/schedule/export]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
