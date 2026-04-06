import fs from "fs/promises";
// Use the internal entry point to avoid pdf-parse v2's canvas polyfill
// which references DOMMatrix — a browser API unavailable in Node.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

export async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text as string;
}
