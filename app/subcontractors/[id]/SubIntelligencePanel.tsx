"use client";

import { useState } from "react";

type Props = {
  subId: number;
  initialTier: string;
  initialProjectTypes: string;
  initialRegion: string | null;
  initialInternalNotes: string | null;
  initialDoNotUse: boolean;
  initialDoNotUseReason: string | null;
};

const TIERS = ["preferred", "approved", "new", "inactive"] as const;

const TIER_COLORS: Record<string, string> = {
  preferred: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  new: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  inactive: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        TIER_COLORS[tier] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {tier}
    </span>
  );
}

export default function SubIntelligencePanel({
  subId,
  initialTier,
  initialProjectTypes,
  initialRegion,
  initialInternalNotes,
  initialDoNotUse,
  initialDoNotUseReason,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tier, setTier] = useState(initialTier);
  const [projectTypes, setProjectTypes] = useState(initialProjectTypes);
  const [region, setRegion] = useState(initialRegion ?? "");
  const [internalNotes, setInternalNotes] = useState(initialInternalNotes ?? "");
  const [doNotUse, setDoNotUse] = useState(initialDoNotUse);
  const [doNotUseReason, setDoNotUseReason] = useState(initialDoNotUseReason ?? "");

  async function save() {
    setSaving(true);
    await fetch(`/api/subcontractors/${subId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tier,
        projectTypes,
        region: region || null,
        internalNotes: internalNotes || null,
        doNotUse,
        doNotUseReason: doNotUseReason || null,
      }),
    });
    setSaving(false);
    setEditing(false);
  }

  const projectTypePills = projectTypes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Intelligence</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Edit
          </button>
        )}
      </div>

      {doNotUse && !editing && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <span className="font-semibold">Do Not Use</span>
          {doNotUseReason && <span className="ml-2 font-normal">&mdash; {doNotUseReason}</span>}
        </div>
      )}

      {editing ? (
        <div className="rounded-md border border-zinc-200 p-4 flex flex-col gap-4 dark:border-zinc-700">
          {/* Tier */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1 dark:text-zinc-300">Tier</label>
            <div className="flex gap-2 flex-wrap">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize border transition-colors ${
                    tier === t
                      ? "border-black bg-black text-white"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Project types */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1 dark:text-zinc-300">
              Project Types{" "}
              <span className="font-normal text-zinc-400 dark:text-zinc-500">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={projectTypes}
              onChange={(e) => setProjectTypes(e.target.value)}
              placeholder="office, industrial, multifamily"
              className="w-full bg-white text-sm text-zinc-900 border border-zinc-300 rounded-md px-2 py-1.5 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-600"
            />
          </div>

          {/* Region */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1 dark:text-zinc-300">Region</label>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. Des Moines Metro"
              className="w-full bg-white text-sm text-zinc-900 border border-zinc-300 rounded-md px-2 py-1.5 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-600"
            />
          </div>

          {/* Internal notes */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1 dark:text-zinc-300">
              Internal Notes
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={3}
              className="w-full bg-white text-sm text-zinc-900 border border-zinc-300 rounded-md px-2 py-1.5 resize-none placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-600"
            />
          </div>

          {/* Do not use */}
          <div className="flex items-start gap-3">
            <input
              id="doNotUse"
              type="checkbox"
              checked={doNotUse}
              onChange={(e) => setDoNotUse(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <label htmlFor="doNotUse" className="text-xs font-medium text-zinc-700 cursor-pointer dark:text-zinc-200">
                Do Not Use
              </label>
              {doNotUse && (
                <input
                  type="text"
                  value={doNotUseReason}
                  onChange={(e) => setDoNotUseReason(e.target.value)}
                  placeholder="Reason…"
                  className="mt-1 w-full bg-white text-sm text-zinc-900 border border-zinc-300 rounded-md px-2 py-1.5 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-600"
                />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="text-sm px-3 py-1.5 rounded bg-black text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-sm px-3 py-1.5 rounded border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-0.5 dark:text-zinc-500">Tier</dt>
            <dd><TierBadge tier={tier} /></dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-0.5 dark:text-zinc-500">Region</dt>
            <dd className="text-zinc-700 dark:text-zinc-200">{region || "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1 dark:text-zinc-500">Project Types</dt>
            <dd>
              {projectTypePills.length === 0 ? (
                <span className="text-zinc-400 dark:text-zinc-500">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {projectTypePills.map((p) => (
                    <span
                      key={p}
                      className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 capitalize dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </div>
          {internalNotes && (
            <div className="col-span-2">
              <dt className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-0.5 dark:text-zinc-500">
                Internal Notes
              </dt>
              <dd className="text-zinc-600 whitespace-pre-wrap dark:text-zinc-300">{internalNotes}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
