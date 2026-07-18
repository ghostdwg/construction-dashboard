"use client";

import { useCallback, useEffect, useState } from "react";

type ItemOption = { id: number; title: string };
type PackageRow = {
  id: number; packageNumber: number; title: string; status: string; displayStatus: string;
  itemCount: number; respondedItemCount: number; responseDueDate: string | null;
};
type Revision = { id: number; revisionIndex: number; responderName: string; channel: string; responseType: string; responseText: string; gcReview: string; gcCommentary: string | null };
type PackageDetail = PackageRow & {
  items: Array<{ id: number; displayNumber: string | null; trackedItem: ItemOption; responses: Revision[] }>;
};

const NEXT: Record<string, string | undefined> = {
  ISSUED: "RESPONSES_IN",
  RESPONSES_IN: "GC_REVIEW",
  GC_REVIEW: "READY_TO_TRANSMIT",
};

export default function ResponsePackagesSection({ bidId, items }: { bidId: number; items: ItemOption[] }) {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [contractorId, setContractorId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/bids/${bidId}/response-packages`);
    if (!response.ok) return;
    const json = (await response.json()) as { packages: PackageRow[] };
    setPackages(json.packages);
  }, [bidId]);

  const loadDetail = useCallback(async (packageId: number) => {
    const response = await fetch(`/api/bids/${bidId}/response-packages/${packageId}`);
    if (!response.ok) return;
    const json = (await response.json()) as { package: PackageDetail };
    setDetail(json.package);
  }, [bidId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/bids/${bidId}/response-packages`)
      .then((response) => response.ok ? response.json() as Promise<{ packages: PackageRow[] }> : null)
      .then((json) => { if (active && json) setPackages(json.packages); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bidId]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    fetch(`/api/bids/${bidId}/response-packages/${selectedId}`)
      .then((response) => response.ok ? response.json() as Promise<{ package: PackageDetail }> : null)
      .then((json) => { if (active && json) setDetail(json.package); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bidId, selectedId]);

  async function mutate(url: string, body?: unknown) {
    setError(null);
    const response = await fetch(url, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const json = (await response.json()) as { error?: string; rawToken?: string };
    if (!response.ok) { setError(json.error ?? "Request failed"); return null; }
    if (json.rawToken) setRawToken(json.rawToken);
    await load();
    if (selectedId) await loadDetail(selectedId);
    return json;
  }

  async function createPackage() {
    const response = await fetch(`/api/bids/${bidId}/response-packages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, ...(due ? { responseDueDate: new Date(due).toISOString() } : {}), ...(contractorId ? { contractorId: Number(contractorId) } : {}) }),
    });
    const json = (await response.json()) as { error?: string; id?: number };
    if (!response.ok) { setError(json.error ?? "Create failed"); return; }
    setTitle(""); setDue(""); setContractorId("");
    await load();
    if (json.id) setSelectedId(json.id);
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700" aria-labelledby="response-packages-heading">
      <div>
        <h4 id="response-packages-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Trade response packages</h4>
        <p className="text-xs text-zinc-500">Bundle existing Operations Register items, issue a package, preserve response revisions, and complete GC review. External links appear once only.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Package title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Package title" className="rounded border px-2 py-1 text-xs dark:bg-zinc-800" />
        <input aria-label="Responsible contractor id" value={contractorId} onChange={(event) => setContractorId(event.target.value)} placeholder="Contractor ID (optional)" inputMode="numeric" className="w-40 rounded border px-2 py-1 text-xs dark:bg-zinc-800" />
        <input aria-label="Response due date" value={due} onChange={(event) => setDue(event.target.value)} type="date" className="rounded border px-2 py-1 text-xs dark:bg-zinc-800" />
        <button disabled={!title.trim()} onClick={() => void createPackage()} className="rounded bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Create draft</button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Response packages">
        {packages.map((pkg) => (
          <button key={pkg.id} onClick={() => { setSelectedId(pkg.id); setRawToken(null); }} className={`rounded border px-2 py-1 text-left text-xs ${selectedId === pkg.id ? "border-blue-500" : "border-zinc-300 dark:border-zinc-600"}`}>
            RP-{pkg.packageNumber} · {pkg.title} · {pkg.displayStatus} · {pkg.respondedItemCount}/{pkg.itemCount}
          </button>
        ))}
      </div>
      {rawToken && (
        <div role="status" className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Copy this portal link now; it will not be shown again: <code className="break-all">/external/response/{rawToken}</code>
        </div>
      )}
      {detail && selectedId === detail.id && (
        <div className="space-y-2 rounded border border-zinc-200 p-2 dark:border-zinc-700">
          <p className="text-xs font-semibold">RP-{detail.packageNumber}: {detail.title} — {detail.displayStatus}</p>
          {detail.status === "DRAFT" && (
            <div className="flex flex-wrap gap-2">
              <select aria-label="Register item to add" value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)} className="rounded border px-2 py-1 text-xs dark:bg-zinc-800">
                <option value="">Choose Register item</option>
                {items.filter((item) => !detail.items.some((member) => member.trackedItem.id === item.id)).map((item) => <option key={item.id} value={item.id}>#{item.id} {item.title}</option>)}
              </select>
              <button disabled={!selectedItemId} onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/items`, { action: "ADD", trackedItemId: Number(selectedItemId) })} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Add item</button>
              <button disabled={detail.items.length === 0} onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/issue`, { delivery: "PORTAL" })} className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-40">Issue portal link</button>
              <button disabled={detail.items.length === 0} onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/issue`, { delivery: "MANUAL", manualChannel: "EMAIL" })} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Issue via email record</button>
            </div>
          )}
          {NEXT[detail.status] && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/status`, { to: NEXT[detail.status] })} className="rounded border px-2 py-1 text-xs">Advance to {NEXT[detail.status]}</button>
              <button onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/rotate-token`, {})} className="rounded border px-2 py-1 text-xs">Rotate portal link</button>
            </div>
          )}
          <ul className="space-y-2">
            {detail.items.map((member) => (
              <li key={member.id} className="rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
                <p className="font-medium">{member.displayNumber ? `${member.displayNumber} · ` : ""}{member.trackedItem.title}</p>
                {member.responses.map((revision) => (
                  <div key={revision.id} className="mt-1 border-l-2 border-zinc-300 pl-2">
                    <p>Revision {revision.revisionIndex} · {revision.channel} · {revision.responseType} · {revision.gcReview}</p>
                    <p>{revision.responseText}</p>
                    {detail.status === "GC_REVIEW" && (
                      <div className="mt-1 flex gap-1">
                        <button onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/items/${member.id}/responses/${revision.id}/gc-review`, { gcReview: "ACCEPTED_FOR_TRANSMITTAL" })} className="rounded border px-1 py-0.5">Accept</button>
                        <button onClick={() => void mutate(`/api/bids/${bidId}/response-packages/${detail.id}/items/${member.id}/responses/${revision.id}/gc-review`, { gcReview: "RETURNED_FOR_REVISION", gcCommentary: "Revision requested by GC" })} className="rounded border px-1 py-0.5">Return for revision</button>
                      </div>
                    )}
                  </div>
                ))}
                {detail.status !== "DRAFT" && detail.status !== "VOIDED" && <ManualResponseForm bidId={bidId} packageId={detail.id} packageItemId={member.id} onSaved={() => loadDetail(detail.id)} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </section>
  );
}

function ManualResponseForm({ bidId, packageId, packageItemId, onSaved }: { bidId: number; packageId: number; packageItemId: number; onSaved: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [responder, setResponder] = useState("");
  async function submit() {
    const response = await fetch(`/api/bids/${bidId}/response-packages/${packageId}/items/${packageItemId}/responses`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responderName: responder, channel: "EMAIL", responseType: "COMPLETED", responseText: text }),
    });
    if (response.ok) { setText(""); setResponder(""); await onSaved(); }
  }
  return <div className="mt-2 flex flex-wrap gap-1"><input aria-label="Manual responder" value={responder} onChange={(e) => setResponder(e.target.value)} placeholder="Responder" className="rounded border px-1 py-0.5 dark:bg-zinc-800" /><input aria-label="Manual response" value={text} onChange={(e) => setText(e.target.value)} placeholder="Response received by email" className="min-w-52 flex-1 rounded border px-1 py-0.5 dark:bg-zinc-800" /><button disabled={!responder.trim() || !text.trim()} onClick={() => void submit()} className="rounded border px-1 py-0.5 disabled:opacity-40">Record response</button></div>;
}
