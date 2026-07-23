import { createHash } from "node:crypto";

export type ParsedSpecParagraph = {
  ordinal: number;
  paragraphLabel: string;
  text: string;
  charStart: number;
  charEnd: number;
  pageNumber: number | null;
  pageEnd: number | null;
  textSha256: string;
};

const LABEL_RE =
  /^\s*((?:\d+(?:\.\d+)*(?:\.[A-Z])?)|(?:[A-Z](?:\.\d+)+)|(?:[A-Z]))(?:[.)]|\s+)/;

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function trimBounds(source: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return [start, end];
}

/**
 * Pure, offset-preserving paragraph parser. Blank lines and CSI-style labels
 * start paragraphs; unlabeled blocks receive stable ¶N fallback labels.
 */
export function parseDeterministicParagraphs(
  rawText: string,
  pageStart: number | null = null,
  pageEnd: number | null = null,
): ParsedSpecParagraph[] {
  if (!rawText.trim()) return [];

  const starts = new Set<number>([0]);
  const lineRe = /(?:^|\n)([^\n]*)/g;
  let match: RegExpExecArray | null;
  let priorBlank = false;
  while ((match = lineRe.exec(rawText)) !== null) {
    const lineStart = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const line = match[1] ?? "";
    const blank = line.trim().length === 0;
    if (!blank && (priorBlank || LABEL_RE.test(line))) starts.add(lineStart);
    priorBlank = blank;
    if (match[0].length === 0) lineRe.lastIndex += 1;
  }

  const orderedStarts = [...starts].sort((a, b) => a - b);
  const parsed: ParsedSpecParagraph[] = [];
  for (let index = 0; index < orderedStarts.length; index += 1) {
    const next = orderedStarts[index + 1] ?? rawText.length;
    const [charStart, charEnd] = trimBounds(rawText, orderedStarts[index], next);
    if (charStart === charEnd) continue;
    const text = rawText.slice(charStart, charEnd);
    const labelMatch = LABEL_RE.exec(text);
    const ordinal = parsed.length + 1;
    parsed.push({
      ordinal,
      paragraphLabel: labelMatch?.[1] ?? `¶${ordinal}`,
      text,
      charStart,
      charEnd,
      pageNumber: pageStart,
      pageEnd,
      textSha256: sha256Text(text),
    });
  }
  return parsed;
}
