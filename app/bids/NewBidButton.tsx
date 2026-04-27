"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type WorkflowType = "BID" | "PROJECT";

const empty = { projectName: "", location: "", dueDate: "", description: "" };

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

export default function NewBidButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workflowType, setWorkflowType] = useState<WorkflowType>("BID");
  const [fields, setFields] = useState(empty);
  const [submitting, setSubmitting] = useState(false);

  function set(key: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  function close() {
    setOpen(false);
    setFields(empty);
    setWorkflowType("BID");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, workflowType }),
    });
    close();
    setSubmitting(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setWorkflowType("BID"); setOpen(true); }}
          className="font-mono text-[11px] uppercase tracking-[0.07em] px-4 py-2 rounded-md transition-colors"
          style={{ background: "var(--signal)", color: "#061009", fontWeight: 700, border: "1px solid var(--signal)" }}
        >
          New Bid
        </button>
        <button
          onClick={() => { setWorkflowType("PROJECT"); setOpen(true); }}
          className="font-mono text-[11px] uppercase tracking-[0.07em] px-4 py-2 rounded-md transition-colors"
          style={{ background: "transparent", color: "var(--text-soft)", border: "1px solid var(--line-strong)" }}
        >
          New Project
        </button>
      </div>
    );
  }

  const isBid = workflowType === "BID";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md flex flex-col gap-4 rounded-lg p-6"
        style={{
          background: "linear-gradient(180deg, #13171f, #0e1119)",
          border: "1px solid var(--line-strong)",
          boxShadow: "var(--shadow)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <h2 className="text-[16px] font-[700] tracking-[-0.02em]">
            {isBid ? "New Bid" : "New Project"}
          </h2>
          <span
            className="font-mono text-[9px] uppercase tracking-[0.07em] px-2 py-1 rounded-full"
            style={{
              background: isBid ? "rgba(126,167,255,0.1)" : "var(--signal-dim)",
              color:      isBid ? "#b8ceff"               : "var(--signal-soft)",
              border:     isBid ? "1px solid rgba(126,167,255,0.2)" : "1px solid rgba(0,255,100,0.22)",
            }}
          >
            {isBid ? "Pursuit flow" : "Construction ready"}
          </span>
        </div>

        {!isBid && (
          <p className="text-[11px] -mt-1" style={{ color: "var(--text-dim)" }}>
            Skips bid pursuit — lands directly on Post-Award tools.
          </p>
        )}

        {/* Project name */}
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
            Project Name <span style={{ color: "var(--signal-soft)" }}>· Required</span>
          </label>
          <input
            autoFocus
            type="text"
            value={fields.projectName}
            onChange={set("projectName")}
            style={inputStyle}
            required
          />
        </div>

        {/* Location + Due Date */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
              Location
            </label>
            <input type="text" value={fields.location} onChange={set("location")} style={inputStyle} />
          </div>
          {isBid && (
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
                Due Date
              </label>
              <input
                type="date"
                value={fields.dueDate}
                onChange={set("dueDate")}
                style={{ ...inputStyle, colorScheme: "dark" }}
              />
            </div>
          )}
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
            Description
          </label>
          <textarea
            value={fields.description}
            onChange={set("description")}
            rows={3}
            style={{ ...inputStyle, resize: "none" }}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="font-mono text-[11px] uppercase tracking-[0.06em] px-4 py-2 rounded transition-colors"
            style={{ border: "1px solid var(--line-strong)", color: "var(--text-soft)", background: "transparent" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="font-mono text-[11px] uppercase tracking-[0.06em] px-4 py-2 rounded transition-colors disabled:opacity-40"
            style={{ background: "var(--signal)", color: "#061009", fontWeight: 700, border: "1px solid var(--signal)" }}
          >
            {submitting ? "Saving…" : isBid ? "Create Bid" : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
