"use client";

import { useCallback, useEffect, useState } from "react";

type Attachment = { id: number; fileName: string; mimeType: string; byteSize: number };
type Revision = { id: number; revisionIndex: number; responderName: string; responseType: string; responseText: string; submittedAt: string; attachments: Attachment[] };
type PackageItem = { id: number; displayNumber: string | null; trackedItem: { title: string; description: string | null; sourceLocator: string | null; dueDate: string | null }; responses: Revision[] };
type Projection = { packageNumber: number; title: string; responseDueDate: string | null; items: PackageItem[] };

export default function ExternalResponsePortal({ token }: { token: string }) {
  const [pkg, setPackage] = useState<Projection | null>(null);
  const [notFound, setNotFound] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/external/response/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) { setNotFound(true); return; }
    const json = (await response.json()) as { package: Projection };
    setPackage(json.package);
  }, [token]);
  useEffect(() => {
    let active = true;
    fetch(`/api/external/response/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => ({ response, json: response.ok ? await response.json() as { package: Projection } : null }))
      .then(({ response, json }) => {
        if (!active) return;
        if (!response.ok || !json) setNotFound(true);
        else setPackage(json.package);
      })
      .catch(() => { if (active) setNotFound(true); });
    return () => { active = false; };
  }, [token]);

  if (notFound) return <main className="mx-auto max-w-2xl p-6"><h1 className="text-xl font-semibold">Response package not found</h1><p className="mt-2 text-sm text-zinc-600">This link is unavailable or has expired.</p></main>;
  if (!pkg) return <main className="mx-auto max-w-2xl p-6" aria-busy="true">Loading response package…</main>;
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header><p className="text-xs uppercase tracking-wide text-zinc-500">GroundWorX trade response</p><h1 className="text-2xl font-semibold">RP-{pkg.packageNumber}: {pkg.title}</h1>{pkg.responseDueDate && <p className="mt-1 text-sm">Response due {new Date(pkg.responseDueDate).toLocaleDateString()}</p>}</header>
      <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">This private link shows only the items assigned to this response package. Submitting again creates a new immutable revision.</p>
      <ol className="space-y-4">
        {pkg.items.map((item) => <li key={item.id} className="rounded-lg border border-zinc-200 p-4"><h2 className="font-semibold">{item.displayNumber ? `${item.displayNumber} · ` : ""}{item.trackedItem.title}</h2>{item.trackedItem.description && <p className="mt-1 text-sm text-zinc-700">{item.trackedItem.description}</p>}{item.trackedItem.sourceLocator && <p className="mt-1 text-xs text-zinc-500">Source: {item.trackedItem.sourceLocator}</p>}<ExternalResponseForm token={token} item={item} onSaved={load} />{item.responses.length > 0 && <div className="mt-3"><h3 className="text-sm font-medium">Submitted revisions</h3><ul className="mt-1 space-y-2">{item.responses.map((revision) => <li key={revision.id} className="rounded bg-zinc-50 p-2 text-sm"><p className="text-xs text-zinc-500">Revision {revision.revisionIndex} · {new Date(revision.submittedAt).toLocaleString()} · {revision.responderName}</p><p>{revision.responseText}</p>{revision.attachments.map((attachment) => <a key={attachment.id} href={`/api/external/response/${encodeURIComponent(token)}/attachments/${attachment.id}/download`} className="mr-2 text-xs underline">{attachment.fileName}</a>)}</li>)}</ul></div>}</li>)}
      </ol>
    </main>
  );
}

function ExternalResponseForm({ token, item, onSaved }: { token: string; item: PackageItem; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""); const [company, setCompany] = useState(""); const [type, setType] = useState("COMPLETED"); const [text, setText] = useState(""); const [proposedDate, setProposedDate] = useState(""); const [actualDate, setActualDate] = useState(""); const [file, setFile] = useState<File | null>(null); const [status, setStatus] = useState<string | null>(null);
  async function submit() {
    setStatus(null);
    const response = await fetch(`/api/external/response/${encodeURIComponent(token)}/items/${item.id}/responses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responderName: name, responderCompany: company || null, responseType: type, responseText: text, proposedCompletionDate: proposedDate ? new Date(proposedDate).toISOString() : null, actualCompletionDate: actualDate ? new Date(actualDate).toISOString() : null }) });
    const json = (await response.json()) as { error?: string; id?: number };
    if (!response.ok || !json.id) { setStatus(json.error ?? "Submission failed"); return; }
    if (file) {
      const form = new FormData(); form.append("file", file);
      const upload = await fetch(`/api/external/response/${encodeURIComponent(token)}/items/${item.id}/responses/${json.id}/attachments`, { method: "POST", body: form });
      if (!upload.ok) { setStatus("Response saved, but the attachment was not accepted."); await onSaved(); return; }
    }
    setText(""); setProposedDate(""); setActualDate(""); setFile(null); setStatus("Response revision submitted."); await onSaved();
  }
  return <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}><div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Responder name<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" /></label><label className="text-sm">Company<input value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" /></label></div><label className="text-sm">Response type<select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1"><option value="COMPLETED">Completed</option><option value="PROPOSED_DATE">Proposed date</option><option value="CLARIFICATION_REQUESTED">Clarification requested</option><option value="DISPUTED">Responsibility disputed</option><option value="NOT_APPLICABLE">Not applicable</option></select></label>{type === "PROPOSED_DATE" && <label className="text-sm">Proposed completion date<input required type="date" value={proposedDate} onChange={(e) => setProposedDate(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" /></label>}{type === "COMPLETED" && <label className="text-sm">Actual completion date (optional)<input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" /></label>}<label className="text-sm">Response<textarea required value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-1 block w-full rounded border px-2 py-1" /></label><label className="text-sm">Optional attachment (PDF, JPEG, PNG, or WebP)<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" /></label><button type="submit" className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white">Submit new revision</button>{status && <p role="status" className="text-sm">{status}</p>}</form>;
}
