"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const empty = { name: "", email: "", phone: "", title: "", isPrimary: false };

export default function AddContactForm({ subId }: { subId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(empty);
  const [submitting, setSubmitting] = useState(false);

  function set(key: keyof typeof empty) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  function close() {
    setOpen(false);
    setFields(empty);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch(`/api/subcontractors/${subId}/contacts`, {
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
        className="text-sm text-zinc-500 border border-zinc-300 rounded-md px-3 py-1.5 hover:bg-zinc-50"
      >
        + Add Contact
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-zinc-200 rounded-md p-4 flex flex-col gap-3 bg-zinc-50"
    >
      <h3 className="text-sm font-semibold">New Contact</h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Name *</label>
          <input
            autoFocus
            type="text"
            value={fields.name}
            onChange={set("name")}
            required
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Title</label>
          <input
            type="text"
            value={fields.title}
            onChange={set("title")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Email</label>
          <input
            type="email"
            value={fields.email}
            onChange={set("email")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Phone</label>
          <input
            type="tel"
            value={fields.phone}
            onChange={set("phone")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={fields.isPrimary}
          onChange={(e) => setFields((f) => ({ ...f, isPrimary: e.target.checked }))}
          className="rounded"
        />
        Set as primary contact
      </label>

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={close}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Add Contact"}
        </button>
      </div>
    </form>
  );
}
