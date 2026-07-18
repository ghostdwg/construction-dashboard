// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/support/fakeExec.ts
//
//  Fake ExecFn for orchestrator/gate unit tests — never spawns a real
//  process. Tests supply a `handler(cmd, args, opts) => ExecResult`; every
//  call is recorded for assertions.
// ──────────────────────────────────────────────────────────────────────────────

export type ExecResult = { status: number; stdout: string; stderr: string };
export type ExecCall = { cmd: string; args: string[]; opts: Record<string, unknown> };
export type ExecHandler = (cmd: string, args: string[], opts: Record<string, unknown>) => ExecResult;

export const OK: ExecResult = { status: 0, stdout: "", stderr: "" };

export function createFakeExec(handler: ExecHandler) {
  const calls: ExecCall[] = [];
  const exec = (cmd: string, args: string[], opts: Record<string, unknown> = {}): ExecResult => {
    calls.push({ cmd, args, opts });
    return handler(cmd, args, opts);
  };
  return { exec, calls };
}

/** Builds a handler from an ordered list of [matcher, result] pairs — first
 *  matcher whose predicate returns true wins; falls through to OK otherwise. */
export function routedExec(routes: Array<[(cmd: string, args: string[]) => boolean, ExecResult]>): ExecHandler {
  return (cmd, args) => {
    for (const [match, result] of routes) {
      if (match(cmd, args)) return result;
    }
    return OK;
  };
}

export function containsAll(...needles: string[]) {
  return (_cmd: string, args: string[]) => needles.every((n) => args.some((a) => a.includes(n)));
}
