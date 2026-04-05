import fs from "fs/promises";
import path from "path";

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

  const dir = path.join(
    process.cwd(),
    "uploads",
    "estimates",
    String(bidId),
    String(subcontractorId)
  );
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return { filePath, fileType };
}
