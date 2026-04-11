"use client";

// Module INT1 — Job Intake Panel
//
// Editable card on the Overview tab capturing project context that branches
// downstream behavior (brief prompt, GNG1 gates, compliance widget).
//
// 14 fields across 5 sections:
//   1. Delivery & Ownership: deliveryMethod, ownerType
//   2. Project Profile:      buildingType, approxSqft, stories
//   3. Public Bid Terms:     ldAmountPerDay, ldCapAmount, dbeGoalPercent (PUBLIC only)
//   4. Site & Constraints:   occupiedSpace, phasingRequired, siteConstraints
//   5. Estimator Notes:      estimatorNotes, scopeBoundaryNotes, veInterest
//
// Pattern: collapsed summary view when populated, expanded edit form when
// the user clicks Edit. Fresh bids get a prominent "Complete project intake"
// CTA prompting them to fill it in.

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type IntakeFields = {
  projectType: "PUBLIC" | "PRIVATE" | "NEGOTIATED";
  deliveryMethod: string | null;
  ownerType: string | null;
  buildingType: string | null;
  approxSqft: number | null;
  stories: number | null;
  ldAmountPerDay: number | null;
  ldCapAmount: number | null;
  occupiedSpace: boolean;
  phasingRequired: boolean;
  siteConstraints: string | null;
  estimatorNotes: string | null;
  scopeBoundaryNotes: string | null;
  veInterest: boolean;
  dbeGoalPercent: number | null;
  // Module H4 — Schedule Seed
  constructionStartDate: string | null; // ISO date (YYYY-MM-DD) or null
};

const DELIVERY_METHODS = [
  { value: "HARD_BID", label: "Hard Bid" },
  { value: "DESIGN_BUILD", label: "Design-Build" },
  { value: "CM_AT_RISK", label: "CM at Risk" },
  { value: "NEGOTIATED", label: "Negotiated" },
];

const OWNER_TYPES = [
  { value: "PUBLIC_ENTITY", label: "Public Entity" },
  { value: "PRIVATE_OWNER", label: "Private Owner" },
  { value: "DEVELOPER", label: "Developer" },
  { value: "INSTITUTIONAL", label: "Institutional" },
];

function labelFor(arr: { value: string; label: string }[], v: string | null): string {
  return arr.find((x) => x.value === v)?.label ?? "—";
}

function fmtNumber(n: number | null, suffix = ""): string {
  if (n == null) return "—";
  return `${n.toLocaleString()}${suffix}`;
}

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString()}`;
}

// Count populated fields (used to compute "completeness")
function countPopulated(f: IntakeFields): { populated: number; total: number } {
  // Total fields counted depends on projectType (public adds 3 LD/DBE fields)
  const baseFields: Array<keyof IntakeFields> = [
    "deliveryMethod",
    "ownerType",
    "buildingType",
    "approxSqft",
    "stories",
    "constructionStartDate",
    "occupiedSpace",
    "phasingRequired",
    "siteConstraints",
    "estimatorNotes",
    "scopeBoundaryNotes",
    "veInterest",
  ];
  const publicExtras: Array<keyof IntakeFields> = [
    "ldAmountPerDay",
    "ldCapAmount",
    "dbeGoalPercent",
  ];
  const fields = f.projectType === "PUBLIC" ? [...baseFields, ...publicExtras] : baseFields;
  let populated = 0;
  for (const k of fields) {
    const v = f[k];
    if (typeof v === "boolean") {
      if (v) populated++;
    } else if (v !== null && v !== undefined && v !== "") {
      populated++;
    }
  }
  return { populated, total: fields.length };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function JobIntakePanel({
  bidId,
  initial,
}: {
  bidId: number;
  initial: IntakeFields;
}) {
  const [data, setData] = useState<IntakeFields>(initial);
  const [draft, setDraft] = useState<IntakeFields>(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync from server props if they change (e.g., parent refresh)
  useEffect(() => {
    setData(initial);
    setDraft(initial);
  }, [initial]);

  const { populated, total } = countPopulated(data);
  const isEmpty = populated === 0;
  const isPublic = data.projectType === "PUBLIC";

  function startEdit() {
    setDraft(data);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(data);
    setError(null);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bids/${bidId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectType: draft.projectType,
          deliveryMethod: draft.deliveryMethod,
          ownerType: draft.ownerType,
          buildingType: draft.buildingType,
          approxSqft: draft.approxSqft,
          stories: draft.stories,
          ldAmountPerDay: draft.ldAmountPerDay,
          ldCapAmount: draft.ldCapAmount,
          occupiedSpace: draft.occupiedSpace,
          phasingRequired: draft.phasingRequired,
          siteConstraints: draft.siteConstraints,
          estimatorNotes: draft.estimatorNotes,
          scopeBoundaryNotes: draft.scopeBoundaryNotes,
          veInterest: draft.veInterest,
          dbeGoalPercent: draft.dbeGoalPercent,
          constructionStartDate: draft.constructionStartDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setData(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Edit form ────────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Project Intake
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Capture project context. These fields branch downstream AI analysis,
              compliance gates, and post-award handoff.
            </p>
          </div>
        </div>

        {/* Section 1: Delivery & Ownership */}
        <Section title="Delivery & Ownership">
          <Row>
            <SelectField
              label="Project Type"
              value={draft.projectType}
              onChange={(v) =>
                setDraft({ ...draft, projectType: v as IntakeFields["projectType"] })
              }
              options={[
                { value: "PUBLIC", label: "Public" },
                { value: "PRIVATE", label: "Private" },
                { value: "NEGOTIATED", label: "Negotiated" },
              ]}
            />
            <SelectField
              label="Delivery Method"
              value={draft.deliveryMethod ?? ""}
              onChange={(v) => setDraft({ ...draft, deliveryMethod: v || null })}
              options={[{ value: "", label: "—" }, ...DELIVERY_METHODS]}
            />
          </Row>
          <Row>
            <SelectField
              label="Owner Type"
              value={draft.ownerType ?? ""}
              onChange={(v) => setDraft({ ...draft, ownerType: v || null })}
              options={[{ value: "", label: "—" }, ...OWNER_TYPES]}
            />
            <div />
          </Row>
        </Section>

        {/* Section 2: Project Profile */}
        <Section title="Project Profile">
          <Row>
            <TextField
              label="Building Type"
              value={draft.buildingType ?? ""}
              onChange={(v) => setDraft({ ...draft, buildingType: v || null })}
              placeholder="e.g. Healthcare, K-12, Office, Multifamily"
            />
            <NumberField
              label="Approx. Sqft"
              value={draft.approxSqft}
              onChange={(v) => setDraft({ ...draft, approxSqft: v })}
              placeholder="0"
            />
          </Row>
          <Row>
            <NumberField
              label="Stories"
              value={draft.stories}
              onChange={(v) => setDraft({ ...draft, stories: v })}
              placeholder="0"
            />
            <DateField
              label="Construction Start Date"
              value={draft.constructionStartDate}
              onChange={(v) => setDraft({ ...draft, constructionStartDate: v })}
            />
          </Row>
        </Section>

        {/* Section 3: Public Bid Terms (PUBLIC only) */}
        {isPublic && (
          <Section title="Public Bid Terms">
            <Row>
              <NumberField
                label="LD Amount / Day ($)"
                value={draft.ldAmountPerDay}
                onChange={(v) => setDraft({ ...draft, ldAmountPerDay: v })}
                placeholder="0"
                allowDecimal
              />
              <NumberField
                label="LD Cap ($)"
                value={draft.ldCapAmount}
                onChange={(v) => setDraft({ ...draft, ldCapAmount: v })}
                placeholder="0"
                allowDecimal
              />
            </Row>
            <Row>
              <NumberField
                label="DBE Goal (%)"
                value={draft.dbeGoalPercent}
                onChange={(v) => setDraft({ ...draft, dbeGoalPercent: v })}
                placeholder="0"
                allowDecimal
              />
              <div />
            </Row>
          </Section>
        )}

        {/* Section 4: Site & Constraints */}
        <Section title="Site & Constraints">
          <Row>
            <CheckField
              label="Occupied Space"
              checked={draft.occupiedSpace}
              onChange={(v) => setDraft({ ...draft, occupiedSpace: v })}
            />
            <CheckField
              label="Phasing Required"
              checked={draft.phasingRequired}
              onChange={(v) => setDraft({ ...draft, phasingRequired: v })}
            />
          </Row>
          <TextareaField
            label="Site Constraints"
            value={draft.siteConstraints ?? ""}
            onChange={(v) => setDraft({ ...draft, siteConstraints: v || null })}
            placeholder="Access, staging, working hours, neighbor sensitivities…"
          />
        </Section>

        {/* Section 5: Estimator Notes */}
        <Section title="Estimator Notes">
          <TextareaField
            label="Estimator Notes"
            value={draft.estimatorNotes ?? ""}
            onChange={(v) => setDraft({ ...draft, estimatorNotes: v || null })}
            placeholder="Internal notes — context, prior history, gut feel…"
          />
          <TextareaField
            label="Scope Boundary Notes"
            value={draft.scopeBoundaryNotes ?? ""}
            onChange={(v) => setDraft({ ...draft, scopeBoundaryNotes: v || null })}
            placeholder="What's in scope vs. out of scope. Carve-outs, owner-supplied items…"
          />
          <CheckField
            label="VE (Value Engineering) interest expressed"
            checked={draft.veInterest}
            onChange={(v) => setDraft({ ...draft, veInterest: v })}
          />
        </Section>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Intake"}
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────

  if (isEmpty) {
    return (
      <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-900/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-blue-900 dark:text-blue-200">
              Complete Project Intake
            </h2>
            <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">
              Capture project context to unlock richer AI analysis, compliance gates,
              and post-award handoff. Takes about 2 minutes.
            </p>
          </div>
          <button
            onClick={startEdit}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Start Intake →
          </button>
        </div>
      </div>
    );
  }

  // ── Summary view ─────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Project Intake
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {populated} of {total} fields populated
          </p>
        </div>
        <button
          onClick={startEdit}
          className="text-xs text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
        >
          Edit
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <SummaryRow label="Delivery Method" value={labelFor(DELIVERY_METHODS, data.deliveryMethod)} />
        <SummaryRow label="Owner Type" value={labelFor(OWNER_TYPES, data.ownerType)} />
        <SummaryRow label="Building Type" value={data.buildingType ?? "—"} />
        <SummaryRow label="Sqft / Stories" value={`${fmtNumber(data.approxSqft)} sf · ${fmtNumber(data.stories)}`} />
        <SummaryRow
          label="Construction Start"
          value={
            data.constructionStartDate
              ? new Date(data.constructionStartDate).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "—"
          }
        />
        {isPublic && (
          <>
            <SummaryRow label="LD per Day" value={fmtDollar(data.ldAmountPerDay)} />
            <SummaryRow label="LD Cap" value={fmtDollar(data.ldCapAmount)} />
            <SummaryRow label="DBE Goal" value={data.dbeGoalPercent != null ? `${data.dbeGoalPercent}%` : "—"} />
            <div />
          </>
        )}
        <SummaryRow label="Occupied Space" value={data.occupiedSpace ? "Yes" : "No"} />
        <SummaryRow label="Phasing Required" value={data.phasingRequired ? "Yes" : "No"} />
        {data.siteConstraints && (
          <div className="col-span-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
              Site Constraints
            </p>
            <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
              {data.siteConstraints}
            </p>
          </div>
        )}
        {data.estimatorNotes && (
          <div className="col-span-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
              Estimator Notes
            </p>
            <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
              {data.estimatorNotes}
            </p>
          </div>
        )}
        {data.scopeBoundaryNotes && (
          <div className="col-span-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-0.5 dark:text-zinc-400">
              Scope Boundary
            </p>
            <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
              {data.scopeBoundaryNotes}
            </p>
          </div>
        )}
        <SummaryRow label="VE Interest" value={data.veInterest ? "Yes" : "No"} />
      </div>
    </div>
  );
}

// ── Form helpers ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 dark:text-zinc-400">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="text-xs font-medium text-zinc-600 block mb-1 dark:text-zinc-300">
      {label}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  allowDecimal,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  allowDecimal?: boolean;
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <input
        type="number"
        step={allowDecimal ? "0.01" : "1"}
        min="0"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(null);
          else {
            const n = allowDecimal ? parseFloat(raw) : parseInt(raw, 10);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        placeholder={placeholder}
        className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-200 mt-5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-zinc-300 accent-blue-600 dark:border-zinc-600 cursor-pointer"
      />
      {label}
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100 resize-none"
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  // ISO string may arrive as full timestamp or YYYY-MM-DD; trim to the date part.
  const datePart = value ? value.slice(0, 10) : "";
  return (
    <div>
      <FieldLabel label={label} />
      <input
        type="date"
        value={datePart}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 dark:text-zinc-100"
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
        {label}
      </p>
      <p className="text-sm text-zinc-800 dark:text-zinc-100">{value}</p>
    </div>
  );
}
