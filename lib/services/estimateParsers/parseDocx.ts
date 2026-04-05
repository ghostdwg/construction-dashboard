import fs from "fs/promises";
// mammoth is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth");

export async function parseDocx(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value as string;
}
