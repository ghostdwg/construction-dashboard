"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const empty = { projectName: "", location: "", dueDate: "", description: "" };

export default function NewBidButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(empty);
  const [submitting, setSubmitting] = useState(false);

  function set(key: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  function close() {
    setOpen(false);
    setFields(empty);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch("/api/bids", {
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
        className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700"
      >
        New Bid
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg flex flex-col gap-4">
        <h2 className="text-lg font-semibold">New Bid</h2>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Project Name *</label>
          <input
            autoFocus
            type="text"
            value={fields.projectName}
            onChange={set("projectName")}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700">Location</label>
            <input
              type="text"
              value={fields.location}
              onChange={set("location")}
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700">Due Date</label>
            <input
              type="date"
              value={fields.dueDate}
              onChange={set("dueDate")}
              className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700">Description</label>
          <textarea
            value={fields.description}
            onChange={set("description")}
            rows={3}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Create Bid"}
          </button>
        </div>
      </div>
    </form>
  );
}
