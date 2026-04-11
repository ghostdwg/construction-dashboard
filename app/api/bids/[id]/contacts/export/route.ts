// GET /api/bids/[id]/contacts/export?format=outlook|google|vcard
//
// Module H7 — Contact Handoff export endpoint.
//
// Bundles the project team contacts (ProjectContact rows) AND the awarded
// subcontractor contacts (BuyoutItem.subcontractorId → primary contact) into
// a single export file in the requested format. Drag straight into Outlook,
// Google Contacts, or Apple Contacts on project handoff.

import {
  loadContactsForExport,
  renderContactExport,
  isValidExportFormat,
  EXPORT_FORMATS,
} from "@/lib/services/contacts/contactExporter";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "outlook";

  if (!isValidExportFormat(format)) {
    return Response.json(
      { error: `format must be one of: ${EXPORT_FORMATS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const data = await loadContactsForExport(bidId);
    if (!data) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }

    const rendered = renderContactExport(format, data.contacts, data.projectName);

    // Filename: ProjectName_Contacts_YYYY-MM-DD.{ext}
    const safeName = data.projectName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${safeName}_Contacts_${dateStr}.${rendered.fileExtension}`;

    return new Response(rendered.body, {
      status: 200,
      headers: {
        "Content-Type": rendered.contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[GET /api/bids/:id/contacts/export]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
