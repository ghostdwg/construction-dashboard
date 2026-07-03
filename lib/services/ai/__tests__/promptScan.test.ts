import { describe, it, expect } from "vitest";
import { scanPrompt, PROMPT_SCAN_VERSION } from "../promptScan";

// Pure, offline tests for the P2-A0 shadow prompt scanner. All inputs are
// synthetic. No provider, no DB, no I/O of any kind — scanPrompt() is a pure
// function of its input string.

describe("prompt scanner — prohibited field markers (high confidence)", () => {
  it("flags exact literal 'pricingData' as high confidence with correct count", () => {
    const result = scanPrompt("pricingData is confidential. pricingData must never leak.");
    expect(result.findings).toEqual([
      { detector: "prohibited_field_marker", count: 2, confidence: "high" },
    ]);
  });

  it("flags exact literal 'rawPriceText' as high confidence", () => {
    const result = scanPrompt("rawPriceText field on EstimateUpload");
    expect(result.findings).toContainEqual({
      detector: "prohibited_field_marker",
      count: 1,
      confidence: "high",
    });
  });

  it("flags exact literal 'isPreferred' as high confidence", () => {
    const result = scanPrompt("Subcontractor.isPreferred must stay internal-only");
    expect(result.findings).toContainEqual({
      detector: "prohibited_field_marker",
      count: 1,
      confidence: "high",
    });
  });

  it("counts all three markers together in one scan", () => {
    const result = scanPrompt("pricingData, rawPriceText, and isPreferred all appear here.");
    expect(result.findings).toEqual([
      { detector: "prohibited_field_marker", count: 3, confidence: "high" },
    ]);
  });
});

describe("prompt scanner — surface syntax (low/medium confidence only, never high)", () => {
  it("detects a dollar amount as medium confidence", () => {
    const result = scanPrompt("Base bid total: $125,430.00");
    const dollar = result.findings.find((f) => f.detector === "dollar_amount");
    expect(dollar).toEqual({ detector: "dollar_amount", count: 1, confidence: "medium" });
  });

  it("detects a unit price as medium confidence", () => {
    const result = scanPrompt("Unit price: 12.50/SF");
    expect(result.findings).toEqual([
      { detector: "unit_price", count: 1, confidence: "medium" },
    ]);
  });

  it("detects a total line as medium confidence", () => {
    const result = scanPrompt("Base bid total: $125,430.00");
    const total = result.findings.find((f) => f.detector === "total_line");
    expect(total).toEqual({ detector: "total_line", count: 1, confidence: "medium" });
  });

  it("detects an email as low confidence", () => {
    const result = scanPrompt("Contact: jane@example.com");
    expect(result.findings).toEqual([{ detector: "email", count: 1, confidence: "low" }]);
  });

  it("detects a phone number as low confidence", () => {
    const result = scanPrompt("Call (515) 555-0101 for details.");
    expect(result.findings).toEqual([{ detector: "phone", count: 1, confidence: "low" }]);
  });

  it("detects a URL as low confidence", () => {
    const result = scanPrompt("See https://example.com/spec for details.");
    expect(result.findings).toEqual([{ detector: "url", count: 1, confidence: "low" }]);
  });

  it("detects a license number as low confidence", () => {
    const result = scanPrompt("Lic. No. AB-1234 on file.");
    expect(result.findings).toEqual([{ detector: "license", count: 1, confidence: "low" }]);
  });

  it("never assigns high confidence to any surface-syntax detector", () => {
    const result = scanPrompt(
      "Contact jane@example.com, call (515) 555-0101, see https://example.com, " +
        "Lic. No. AB-1234, total: $500, unit price 12/SF"
    );
    for (const f of result.findings) {
      if (f.detector !== "prohibited_field_marker") {
        expect(f.confidence).not.toBe("high");
      }
    }
  });
});

describe("prompt scanner — spec-like prose (honest heuristic behavior, including false positives)", () => {
  it("does NOT flag 'preferred manufacturer' — distinct from the isPreferred marker", () => {
    const result = scanPrompt("Contractor shall confirm preferred manufacturer before ordering.");
    expect(result.findings).toEqual([]);
  });

  it("does NOT flag CSI section references", () => {
    const result = scanPrompt("Division 09 21 16 — Gypsum Board Assemblies, Section 01 32 00");
    expect(result.findings).toEqual([]);
  });

  it("does NOT flag a job address", () => {
    const result = scanPrompt("Job address: 4500 Grand Ave, Des Moines, IA 50309");
    expect(result.findings).toEqual([]);
  });

  it("KNOWN FALSE POSITIVE: flags 'a total of 3 copies' as a total_line — the word " +
    "'total' followed by any digit on the same line is a surface-syntax match, " +
    "even though this sentence has nothing to do with pricing. Documented, not disguised.",
    () => {
      const result = scanPrompt("Please provide a total of 3 copies of the executed contract.");
      expect(result.findings).toEqual([
        { detector: "total_line", count: 1, confidence: "medium" },
      ]);
    }
  );
});

describe("prompt scanner — truncation", () => {
  it("caps scanning at 200,000 characters and reports truncated=true", () => {
    const big = "a".repeat(250_000);
    const result = scanPrompt(big);
    expect(result.truncated).toBe(true);
    expect(result.scannedChars).toBe(200_000);
  });

  it("reports truncated=false and full length for input under the cap", () => {
    const result = scanPrompt("short text");
    expect(result.truncated).toBe(false);
    expect(result.scannedChars).toBe("short text".length);
  });

  it("only scans within the 200k bound — a marker placed after the cutoff is not found", () => {
    const padding = "x".repeat(200_000);
    const result = scanPrompt(padding + "pricingData");
    expect(result.truncated).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("stays fast on adversarial near-match input at the size cap (no catastrophic backtracking)", () => {
    // Each of these targets a detector's own worst case: a long run of
    // characters that almost — but never — completes a match, with no
    // anchor character present. An earlier version of this scanner had an
    // unbounded-quantifier email/license/unit-price/total-line pattern that
    // took 30-80s on inputs like these; every detector must now resolve in
    // well under a second regardless of input shape.
    const probes = [
      "a".repeat(250_000), // no "@" anywhere — old EMAIL_RE bug
      "1".repeat(250_000), // digits with no separators — phone/unit-price
      "Lic" + " ".repeat(250_000), // trailing whitespace run — old LICENSE_RE bug
      "total ".repeat(40_000), // repeated trigger word, no digit — old TOTAL_LINE_RE bug
    ];
    const t0 = Date.now();
    for (const p of probes) scanPrompt(p);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("prompt scanner — leak safety", () => {
  it("never includes the matched text, only counts and detector labels", () => {
    const secretEmail = "definitely-not-a-real-address@example.com";
    const result = scanPrompt(`Contact ${secretEmail} for questions. pricingData too.`);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretEmail);
    expect(serialized).not.toContain("pricingData");
  });

  it("never includes a raw dollar value, only the detector label and count", () => {
    const result = scanPrompt("The confidential figure is $987,654.32 exactly.");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("987,654.32");
    expect(serialized).not.toContain("$987");
  });
});

describe("prompt scanner — contract shape", () => {
  it("returns the required envelope fields", () => {
    const result = scanPrompt("hello world");
    expect(result.scannerVersion).toBe(PROMPT_SCAN_VERSION);
    expect(result.mode).toBe("shadow");
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.scannedChars).toBe("number");
    expect(typeof result.truncated).toBe("boolean");
  });

  it("is pure — calling it twice with the same input yields identical output", () => {
    const a = scanPrompt("pricingData $100 jane@example.com");
    const b = scanPrompt("pricingData $100 jane@example.com");
    expect(a).toEqual(b);
  });
});
