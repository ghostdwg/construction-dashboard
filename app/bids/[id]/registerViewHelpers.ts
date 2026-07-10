// Pure view helpers for the Operations Register (OPS polish V1).
// No fetches, no Prisma, no side effects — unit-tested directly in
// __tests__/registerViewHelpers.test.ts without a render harness.

export const TERMINAL_STATUSES = new Set(["CLOSED", "WAIVED"]);

/** Count items per status, in a stable order for summary chips. */
export function statusCounts(
  items: ReadonlyArray<{ status: string }>
): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  const order = ["OPEN", "IN_PROGRESS", "READY_TO_CLOSE", "CLOSED", "WAIVED"];
  const known = order
    .filter((s) => counts.has(s))
    .map((s) => ({ status: s, count: counts.get(s)! }));
  const unknown = [...counts.keys()]
    .filter((s) => !order.includes(s))
    .sort()
    .map((s) => ({ status: s, count: counts.get(s)! }));
  return [...known, ...unknown];
}

/**
 * An item is overdue when it has a due date before the start of "today"
 * and is still actionable. CLOSED/WAIVED items are never overdue —
 * flagging finished work would be noise, not signal.
 */
export function isOverdue(
  dueDate: string | null,
  status: string,
  now: Date = new Date()
): boolean {
  if (!dueDate || TERMINAL_STATUSES.has(status)) return false;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < startOfToday.getTime();
}

/**
 * Meeting action items already promoted into the register, derived from
 * the register rows currently loaded. A HINT for the picker UI only —
 * the server's unique constraint (409) is the source of truth, and this
 * set can under-report when the register is viewed with filters applied.
 */
export function promotedActionItemIds(
  items: ReadonlyArray<{ sourceMeetingActionItemId: number | null }>
): Set<number> {
  const ids = new Set<number>();
  for (const item of items) {
    if (item.sourceMeetingActionItemId != null) ids.add(item.sourceMeetingActionItemId);
  }
  return ids;
}

/** Compact option label for the promote picker. */
export function actionItemOptionLabel(opt: {
  id: number;
  meetingTitle: string;
  description: string;
  alreadyTracked: boolean;
}): string {
  const desc =
    opt.description.length > 60 ? `${opt.description.slice(0, 57)}…` : opt.description;
  return `#${opt.id} · ${opt.meetingTitle} — ${desc}${opt.alreadyTracked ? " · already tracked" : ""}`;
}
