import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminAuthorized } from "@/lib/auth";
import InviteUserForm from "./InviteUserForm";

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "pm" | "estimator";
  createdAt: string;
};

const joinedFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const ROLE_STYLES: Record<UserRow["role"], { color: string; background: string; borderColor: string }> = {
  admin: {
    color: "var(--signal-soft)",
    background: "var(--signal-dim)",
    borderColor: "var(--signal)",
  },
  pm: {
    color: "var(--blue)",
    background: "transparent",
    borderColor: "var(--blue)",
  },
  estimator: {
    color: "var(--text-dim)",
    background: "transparent",
    borderColor: "var(--line)",
  },
};

async function loadUsers(): Promise<{ users: UserRow[]; error: string | null }> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol =
    headerStore.get("x-forwarded-proto") ??
    (host?.includes("localhost") ? "http" : "https");
  const cookie = headerStore.get("cookie");

  if (!host) {
    return { users: [], error: "Unable to resolve the current host" };
  }

  try {
    const res = await fetch(`${protocol}://${host}/api/admin/users`, {
      method: "GET",
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { users: [], error: err.error ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { users: UserRow[] };
    return { users: data.users, error: null };
  } catch (error) {
    return {
      users: [],
      error: error instanceof Error ? error.message : "Failed to load users",
    };
  }
}

function RoleBadge({ role }: { role: UserRow["role"] }) {
  const style = ROLE_STYLES[role];

  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={style}
    >
      {role}
    </span>
  );
}

export default async function UsersSettingsPage() {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    redirect(adminCheck.status === 401 ? "/login" : "/");
  }

  const { users, error } = await loadUsers();

  return (
    <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column" }}>
      <div className="border-b px-7 py-[22px]" style={{ borderColor: "var(--line)" }}>
        <p
          className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-dim)" }}
        >
          Settings
        </p>
        <h1
          className="text-[20px] font-[700] tracking-[-0.03em]"
          style={{ color: "var(--text)" }}
        >
          User Management
        </h1>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-soft)" }}>
          Invite teammates, review roles, and track when access was created.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-5 px-7 py-6">
        <section
          className="overflow-hidden rounded-[var(--radius)] border"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div
            className="flex items-center justify-between gap-3 border-b px-5 py-4"
            style={{ borderColor: "var(--line)" }}
          >
            <p
              className="font-mono text-[9px] uppercase tracking-[0.14em]"
              style={{ color: "var(--text-dim)" }}
            >
              team
            </p>
            <span
              className="rounded-full border px-2 py-1 font-mono text-[10px]"
              style={{ borderColor: "var(--line)", color: "var(--text-dim)" }}
            >
              {users.length}
            </span>
          </div>

          {error ? (
            <div className="px-5 py-4">
              <p className="text-[13px]" style={{ color: "var(--red)" }}>
                {error}
              </p>
            </div>
          ) : users.length === 0 ? (
            <div className="px-5 py-6">
              <p className="text-[13px]" style={{ color: "var(--text-soft)" }}>
                No users found yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <th
                      className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.09em]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      Name
                    </th>
                    <th
                      className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.09em]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      Email
                    </th>
                    <th
                      className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.09em]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      Role
                    </th>
                    <th
                      className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-[0.09em]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      Joined
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td className="px-5 py-3 text-[13px]" style={{ color: "var(--text)" }}>
                        {user.name?.trim() || "-"}
                      </td>
                      <td className="px-5 py-3 text-[13px]" style={{ color: "var(--text-soft)" }}>
                        {user.email}
                      </td>
                      <td className="px-5 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-5 py-3 text-[13px]" style={{ color: "var(--text-soft)" }}>
                        {joinedFormatter.format(new Date(user.createdAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <InviteUserForm />
      </div>
    </div>
  );
}
