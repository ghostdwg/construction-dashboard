// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/support/fakeFs.ts
//
//  Minimal in-memory fs fake for orchestrator/gate unit tests — never touches
//  the real filesystem. Implements exactly the subset of node:fs used by
//  scripts/certification/lib/*.mjs (existsSync, mkdirSync, writeFileSync,
//  readFileSync, readdirSync, statSync).
// ──────────────────────────────────────────────────────────────────────────────

function dirnameOf(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

export class FakeFs {
  files = new Map<string, string>();
  dirs = new Set<string>(["/"]);

  seedDir(path: string) {
    let cur = path;
    while (cur && cur !== "/" && !this.dirs.has(cur)) {
      this.dirs.add(cur);
      cur = dirnameOf(cur);
    }
    this.dirs.add("/");
  }

  seedFile(path: string, content: string) {
    this.seedDir(dirnameOf(path));
    this.files.set(path, content);
  }

  existsSync = (path: string): boolean => this.files.has(path) || this.dirs.has(path);

  mkdirSync = (path: string, _opts?: { recursive?: boolean }): void => {
    this.seedDir(path);
  };

  writeFileSync = (path: string, content: string): void => {
    this.seedFile(path, content);
  };

  readFileSync = (path: string, _encoding?: string): string => {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file, open '${path}'`);
    }
    return this.files.get(path)!;
  };

  readdirSync = (path: string): string[] => {
    const seen = new Set<string>();
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const p of [...this.files.keys(), ...this.dirs.keys()]) {
      if (p === path) continue;
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        seen.add(rest.split("/")[0]);
      }
    }
    if (seen.size === 0 && !this.dirs.has(path)) {
      throw new Error(`ENOENT: no such directory, scandir '${path}'`);
    }
    return [...seen];
  };

  statSync = (path: string): { isDirectory(): boolean } => {
    const isDir = this.dirs.has(path) && !this.files.has(path);
    return { isDirectory: () => isDir };
  };
}
