"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type WorkflowType = "BID" | "PROJECT";

const empty = { projectName: "", location: "", dueDate: "", description: "" };

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
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          New Bid
        </button>
        <button
          onClick={() => { setWorkflowType("PROJECT"); setOpen(true); }}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          New Project
        </button>
      </div>
    );
  }

  const isBid = workflowType === "BID";

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg flex flex-col gap-4 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{isBid ? "New Bid" : "New Project"}</h2>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${
            isBid
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          }`}>
            {isBid ? "Pursuit flow" : "Construction ready"}
          </span>
        </div>

        {!isBid && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-1">
            Skips bid pursuit — lands directly on Post-Award tools (Handoff, Submittals, Schedule, etc.).
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Project Name *</label>
          <input
            autoFocus
            type="text"
            value={fields.projectName}
            onChange={set("projectName")}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Location</label>
            <input
              type="text"
              value={fields.location}
              onChange={set("location")}
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
            />
          </div>
          {isBid && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Due Date</label>
              <input
                type="date"
                value={fields.dueDate}
                onChange={set("dueDate")}
                className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Description</label>
          <textarea
            value={fields.description}
            onChange={set("description")}
            rows={3}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {submitting ? "Saving…" : isBid ? "Create Bid" : "Create Project"}
          </button>
        </div>
      </div>
    </form>
  );
}
