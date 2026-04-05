import { parsePdf } from "./parsePdf";
import { parseExcel, ExcelRow } from "./parseExcel";
import { parseDocx } from "./parseDocx";

export type ParseResult = {
  rawText: string;
  rows?: ExcelRow[];
};

export async function parseEstimateFile(
  filePath: string,
  fileType: string
): Promise<ParseResult> {
  switch (fileType) {
    case "pdf": {
      const rawText = await parsePdf(filePath);
      return { rawText };
    }
    case "excel": {
      const { rawText, rows } = await parseExcel(filePath);
      return { rawText, rows };
    }
    case "docx": {
      const rawText = await parseDocx(filePath);
      return { rawText };
    }
    default:
      throw new Error(`Unsupported fileType: ${fileType}`);
  }
}
