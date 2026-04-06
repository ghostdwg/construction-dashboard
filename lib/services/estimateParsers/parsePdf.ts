import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function parsePdf(filePath: string): Promise<string> {
  const fs = await import("fs/promises");
  const buffer = await fs.readFile(filePath);

  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdfDoc = await loadingTask.promise;

  let text = "";
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    text +=
      content.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ") + "\n";
  }

  return text;
}
