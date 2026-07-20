"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LEAD_TYPES = [
  { value: "MANUAL",         label: "Manual Entry" },
  { value: "PERMIT",         label: "Permit Filing" },
  { value: "MEETING_MINUTE", label: "Meeting Minute" },
  { value: "PLAN_ROOM",      label: "Plan Room" },
  { value: "LAND_ACQUISITION", label: "Land Acquisition" },
  { value: "BROKER",         label: "Broker Listing" },
  { value: "RELATIONSHIP",   label: "Relationship Intel" },
];

const empty = {
  title: "", leadType: "MANUAL", location: "", jurisdiction: "",
  projectType: "", estimatedValue: "", source: "", sourceUrl: "", notes: "",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.11)",
  color: "var(--text)",
  borderRadius: "4px",
  padding: "9px 12px",
  fontSize: "12px",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
};

export default function NewLeadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(empty);
  const [submitting, setSubmitting] = useState(false);

  function set(key: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  function close() { setOpen(false); setFields(empty); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/market-intelligence/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    close();
    setSubmitting(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="font-mono text-[11px] uppercase tracking-[0.07em] px-4 py-2 rounded-md"
        style={{ background: "var(--signal)", color: "#061009", fontWeight: 700, border: "1px solid var(--signal)" }}
      >
        + Add Lead
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg flex flex-col gap-4 rounded-lg p-6"
        style={{
          background: "linear-gradient(180deg, #13171f, #0e1119)",
          border: "1px solid var(--line-strong)",
          boxShadow: "var(--shadow)",
        }}
      >
        <div>
          <h2 className="text-[16px] font-[700] tracking-[-0.02em]">Add Market Lead</h2>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-dim)" }}>
            Manual entry — scrapers add signals automatically when running.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
            Title <span style={{ color: "var(--signal-soft)" }}>· Required</span>
          </label>
          <input autoFocus type="text" value={fields.title} onChange={set("title")} style={inputStyle} required placeholder="e.g. New Elementary School — Riverside USD" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Lead Type</label>
            <select value={fields.leadType} onChange={set("leadType")} style={{ ...inputStyle, appearance: "none" }}>
              {LEAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Est. Value ($)</label>
            <input type="number" value={fields.estimatedValue} onChange={set("estimatedValue")} style={inputStyle} placeholder="5000000" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Location</label>
            <input type="text" value={fields.location} onChange={set("location")} style={inputStyle} placeholder="City, State" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Jurisdiction</label>
            <input type="text" value={fields.jurisdiction} onChange={set("jurisdiction")} style={inputStyle} placeholder="County / City" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Project Type</label>
            <input type="text" value={fields.projectType} onChange={set("projectType")} style={inputStyle} placeholder="K-12, Office, Mixed-Use…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Source</label>
            <input type="text" value={fields.source} onChange={set("source")} style={inputStyle} placeholder="city_hall, beeline, manual…" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Source URL</label>
          <input type="url" value={fields.sourceUrl} onChange={set("sourceUrl")} style={inputStyle} placeholder="https://…" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>Notes</label>
          <textarea value={fields.notes} onChange={set("notes")} rows={2} style={{ ...inputStyle, resize: "none" }} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button" onClick={close}
            className="font-mono text-[11px] uppercase tracking-[0.06em] px-4 py-2 rounded"
            style={{ border: "1px solid var(--line-strong)", color: "var(--text-soft)", background: "transparent" }}
          >
            Cancel
          </button>
          <button
            type="submit" disabled={submitting}
            className="font-mono text-[11px] uppercase tracking-[0.06em] px-4 py-2 rounded disabled:opacity-40"
            style={{ background: "var(--signal)", color: "#061009", fontWeight: 700, border: "1px solid var(--signal)" }}
          >
            {submitting ? "Saving…" : "Add Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
