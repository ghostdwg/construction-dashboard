"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewBidPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const data = {
      projectName: (form.elements.namedItem("projectName") as HTMLInputElement).value,
      location: (form.elements.namedItem("location") as HTMLInputElement).value || undefined,
      dueDate: (form.elements.namedItem("dueDate") as HTMLInputElement).value || undefined,
      description: (form.elements.namedItem("description") as HTMLTextAreaElement).value || undefined,
    };

    const res = await fetch("/api/bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Something went wrong.");
      return;
    }

    router.push("/bids");
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold mb-6">New Bid</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="projectName" className="text-sm font-medium text-zinc-700">
            Project Name <span className="text-red-500">*</span>
          </label>
          <input
            id="projectName"
            name="projectName"
            type="text"
            required
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="location" className="text-sm font-medium text-zinc-700">
            Location
          </label>
          <input
            id="location"
            name="location"
            type="text"
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="dueDate" className="text-sm font-medium text-zinc-700">
            Due Date
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-zinc-700">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            className="rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Create Bid
          </button>
          <button
            type="button"
            onClick={() => router.push("/bids")}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
