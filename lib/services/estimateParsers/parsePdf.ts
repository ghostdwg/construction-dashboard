import fs from "fs/promises";
// pdf-parse is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

export async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text as string;
}
