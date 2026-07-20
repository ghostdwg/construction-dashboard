"use client";

import { useState, type FormEvent, type HTMLInputTypeAttribute } from "react";

type Role = "admin" | "estimator" | "pm";

export default function InviteUserForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("estimator");
  const [submitting, setSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setTempPassword(null);
    setError(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          role,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { tempPassword: string };
      setEmail("");
      setName("");
      setRole("estimator");
      setTempPassword(data.tempPassword);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-[var(--radius)] border px-5 py-5"
      style={{ borderColor: "var(--line)", background: "var(--panel)" }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p
            className="font-mono text-[9px] uppercase tracking-[0.14em]"
            style={{ color: "var(--text-dim)" }}
          >
            invite
          </p>
          <h2
            className="mt-1 text-[16px] font-[700] tracking-[-0.03em]"
            style={{ color: "var(--text)" }}
          >
            Add Team Member
          </h2>
        </div>

        {tempPassword && (
          <span
            className="rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{
              borderColor: "var(--signal)",
              background: "var(--signal-dim)",
              color: "var(--signal-soft)",
            }}
          >
            User created
          </span>
        )}
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            id="invite-email"
            label="Email"
            value={email}
            onChange={setEmail}
            placeholder="user@company.com"
            type="email"
            disabled={submitting}
          />
          <Field
            id="invite-name"
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Jordan Lee"
            disabled={submitting}
          />
        </div>

        <div className="max-w-[240px]">
          <label
            htmlFor="invite-role"
            className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ color: "var(--text-dim)" }}
          >
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            disabled={submitting}
            className="w-full rounded-[var(--radius)] border px-3 py-2.5 text-[13px] outline-none transition-colors"
            style={{
              borderColor: "var(--line)",
              background: "var(--bg)",
              color: "var(--text)",
            }}
          >
            <option value="admin">admin</option>
            <option value="estimator">estimator</option>
            <option value="pm">pm</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || email.trim() === "" || name.trim() === ""}
            className="rounded-[var(--radius)] border px-4 py-2 text-[13px] font-[600] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--signal)",
              background: "var(--signal-dim)",
              color: "var(--signal-soft)",
            }}
          >
            Add User
          </button>

          {error && (
            <p className="text-[13px]" style={{ color: "var(--red)" }}>
              {error}
            </p>
          )}
        </div>

        {tempPassword && (
          <div
            className="rounded-[var(--radius)] border px-4 py-3"
            style={{ borderColor: "var(--signal)", background: "var(--signal-dim)" }}
          >
            <p
              className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em]"
              style={{ color: "var(--signal-soft)" }}
            >
              Temp password — share this with the user
            </p>
            <p className="font-mono text-[14px] font-[600]" style={{ color: "var(--text)" }}>
              {tempPassword}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-soft)" }}>
              This is only shown once. It is not stored in plaintext.
            </p>
          </div>
        )}
      </form>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  type?: HTMLInputTypeAttribute;
  disabled: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-[var(--radius)] border px-3 py-2.5 text-[13px] outline-none transition-colors placeholder:opacity-100"
        style={{
          borderColor: "var(--line)",
          background: "var(--bg)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}
