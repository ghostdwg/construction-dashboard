import ExcelJS from "exceljs";

export type ExcelRow = Record<string, string | number | boolean | null>;

export async function parseExcel(
  filePath: string
): Promise<{ rawText: string; rows: ExcelRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const rows: ExcelRow[] = [];
  const textLines: string[] = [];

  workbook.eachSheet((sheet) => {
    // Collect header row to use as keys
    let headers: string[] = [];

    sheet.eachRow((row, rowNumber) => {
      const values = row.values as (string | number | boolean | null)[];
      // ExcelJS row.values is 1-indexed, index 0 is undefined
      const cells = values.slice(1);

      if (rowNumber === 1) {
        headers = cells.map((v) => (v != null ? String(v) : `col${rowNumber}`));
        return;
      }

      const obj: ExcelRow = {};
      const lineparts: string[] = [];
      cells.forEach((val, i) => {
        const key = headers[i] ?? `col${i + 1}`;
        obj[key] = val ?? null;
        if (val != null) lineparts.push(String(val));
      });

      if (lineparts.length > 0) {
        rows.push(obj);
        textLines.push(lineparts.join("\t"));
      }
    });
  });

  return { rawText: textLines.join("\n"), rows };
}
