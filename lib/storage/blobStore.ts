/**
 * BlobStore — pluggable blob storage abstraction.
 *
 * Implementations: LocalBlobStore (filesystem, current) and (future) S3BlobStore.
 * Wired via STORAGE_BACKEND env var; defaults to local.
 *
 * Path conventions (from docs/architecture/STORAGE.md):
 *   market/docs/{sourceId}/{YYYY}/{MM}/{docId}.{ext}
 *   plan-room/jobs/{jobId}/{kind}/{file}
 *   meetings/{meetingId}/{file}
 *
 * Keys are forward-slash separated relative paths. The store enforces no
 * leading slash, no path traversal (..), no absolute paths.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type PutResult = {
  size: number;
  sha256: string;
  storedAt: string;       // ISO timestamp
};

export type Stat = {
  size: number;
  sha256: string;
  modifiedAt: Date;
};

export interface BlobStore {
  /** Write a blob. Overwrites if key exists. */
  put(key: string, data: Buffer, opts?: { contentType?: string }): Promise<PutResult>;
  /** Read a blob. Throws if missing. */
  get(key: string): Promise<Buffer>;
  /** Stat a blob. Returns null if missing. */
  stat(key: string): Promise<Stat | null>;
  /** True if blob exists. */
  exists(key: string): Promise<boolean>;
  /** Delete a blob. No-op if missing. */
  delete(key: string): Promise<void>;
}

function assertSafeKey(key: string): void {
  if (!key || typeof key !== "string") throw new Error("BlobStore: empty key");
  if (key.startsWith("/") || key.startsWith("\\")) throw new Error("BlobStore: absolute path not allowed");
  if (/(^|\/)\.\.(\/|$)/.test(key)) throw new Error("BlobStore: path traversal not allowed");
  if (key.length > 1024) throw new Error("BlobStore: key too long");
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {
    if (!path.isAbsolute(root)) {
      throw new Error(`LocalBlobStore: root must be absolute, got ${root}`);
    }
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<PutResult> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return {
      size: data.length,
      sha256: sha256(data),
      storedAt: new Date().toISOString(),
    };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async stat(key: string): Promise<Stat | null> {
    try {
      const full = this.resolve(key);
      const st = await fs.stat(full);
      const buf = await fs.readFile(full);
      return { size: st.size, sha256: sha256(buf), modifiedAt: st.mtime };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

let _store: BlobStore | null = null;

/** Get the configured blob store. Singleton per process. */
export function getBlobStore(): BlobStore {
  if (_store) return _store;
  const backend = process.env.STORAGE_BACKEND || "local";
  if (backend === "local") {
    const root = process.env.STORAGE_LOCAL_PATH || "/storage";
    _store = new LocalBlobStore(root);
    return _store;
  }
  throw new Error(`Unsupported STORAGE_BACKEND: ${backend}`);
}

/** Convenience: build a key for a market intelligence doc. */
export function marketDocKey(sourceId: string, docId: string, ext: string, date?: Date): string {
  const d = date ?? new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `market/docs/${sourceId}/${y}/${m}/${docId}.${ext.replace(/^\./, "")}`;
}
