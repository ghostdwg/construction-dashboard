// R2 auth/durability regression pack — wraps a MockPrisma (see ./mockPrisma)
// so every table-method call increments a shared counter, following the
// counting-proxy technique already used in
// app/api/bids/[id]/meetings/[meetingId]/register/__tests__/security.test.ts.
// Lets a single assertion (`counter.count === 0`) prove zero database work
// happened for a denied/short-circuited request, across many methods/tables
// without hand-listing them.

import type { MockPrisma, Table } from "./mockPrisma";

export type CallCounter = { count: number };

function wrapTable(table: Table, counter: CallCounter): Table {
  const wrapped: Record<string, unknown> = { rows: table.rows };
  for (const key of ["findFirst", "findUnique", "findMany", "count", "create", "update", "updateMany", "deleteMany"] as const) {
    const original = table[key] as (...args: unknown[]) => unknown;
    wrapped[key] = (...args: unknown[]) => {
      counter.count++;
      return original.apply(table, args);
    };
  }
  return wrapped as Table;
}

/** Returns a prisma-shaped object whose every table method call increments
 *  `counter.count`, plus a transaction wrapper that counts as a single call
 *  in addition to whatever the callback does through the wrapped tables. */
export function withCallCounter(prisma: MockPrisma): { prisma: MockPrisma; counter: CallCounter } {
  const counter: CallCounter = { count: 0 };
  const wrapped = {} as MockPrisma;
  for (const key of Object.keys(prisma) as Array<keyof MockPrisma>) {
    if (key === "$transaction") continue;
    (wrapped as Record<string, unknown>)[key] = wrapTable(prisma[key] as Table, counter);
  }
  // Delegate to the real (snapshot/rollback-capable) $transaction so a
  // mutation that DOES proceed still gets genuine atomicity — only the call
  // count and the tx-scoped table wrapping are added here.
  wrapped.$transaction = async (fn) => {
    counter.count++;
    return prisma.$transaction((tx) => {
      const wrappedTx = {} as MockPrisma;
      for (const key of Object.keys(tx) as Array<keyof MockPrisma>) {
        if (key === "$transaction") continue;
        (wrappedTx as Record<string, unknown>)[key] = wrapTable(tx[key] as Table, counter);
      }
      return fn(wrappedTx);
    });
  };
  return { prisma: wrapped, counter };
}
