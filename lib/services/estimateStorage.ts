import path from "path";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { estimateStorageKey } from "@/lib/services/estimates/storagePath";

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".pdf": "pdf",
  ".xlsx": "excel",
  ".xls": "excel",
  ".docx": "docx",
};

export function resolveFileType(
  mimeType: string,
  fileName: string
): string | null {
  if (ALLOWED_TYPES[mimeType]) return ALLOWED_TYPES[mimeType];
  const ext = path.extname(fileName).toLowerCase();
  return ALLOWED_EXTENSIONS[ext] ?? null;
}

export async function saveEstimateFile(
  bidId: number,
  subcontractorId: number,
  file: File
): Promise<{ filePath: string; fileType: string }> {
  const fileType = resolveFileType(file.type, file.name);
  if (!fileType) {
    throw new Error(
      `Unsupported file type: ${file.type || path.extname(file.name)}`
    );
  }

  // Persist durably through BlobStore under a relative key matching
  // production's namespace convention
  // (uploads/estimates/{bidId}/{subcontractorId}/{safe name}) — never an
  // absolute path. Only this relative key is ever returned/stored; resolving
  // it back to a real local absolute path (for the synchronous in-request
  // parse call) happens at that trusted boundary, via
  // lib/services/estimates/storagePath.ts.
  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = estimateStorageKey(bidId, subcontractorId, safeBlobFileName(file.name));
  await getBlobStore().put(filePath, buffer);

  return { filePath, fileType };
}
