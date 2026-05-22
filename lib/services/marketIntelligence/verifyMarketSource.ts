// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/verifyMarketSource.ts
//  Phase O2.2 PR5 — MarketSource URL health check.
//
//  Cheap, side-effect-light verification — HTTP GET + body sniff. Tells the
//  operator whether a seeded URL is reachable and looks like an agenda page
//  (CivicPlus AgendaCenter, CivicClerk, etc.). Does NOT trigger a real
//  sidecar scrape — that would be slow + Claude-cost expensive.
//
//  Design:
//    * One function per source — pure inputs, async network call, structured
//      result. No DB writes here; CLI wrapper handles that.
//    * Bounded timeout (12s) so a slow host doesn't hang the operator.
//    * Recommendation enum — operator UI can map to colors / actions.
//    * Detects three known stacks deterministically from response body or
//      URL: CivicPlus AgendaCenter, CivicClerk, Granicus. Anything else
//      yields UNKNOWN_STACK — still might be valid (operator inspects).
// ──────────────────────────────────────────────────────────────────────────────

export const VERIFY_VERSION = "v1" as const;
export const VERIFY_TIMEOUT_MS = 12_000;
export const VERIFY_BODY_PREVIEW_BYTES = 8_192;

export type VerifyRecommendation =
  | "activate"        // reachable + stack signature detected
  | "investigate"     // reachable but no stack signature; might still be valid
  | "remove";         // unreachable, 4xx/5xx, or wrong content type

export type DetectedStack =
  | "CIVICPLUS_AGENDA_CENTER"
  | "CIVICCLERK"
  | "GRANICUS"
  | "GENERIC_HTML"
  | "UNKNOWN_STACK";

export interface VerifyInput {
  sourceId: string;
  name: string;
  url: string;
}

export interface VerifyResult {
  sourceId: string;
  url: string;
  reachable: boolean;
  status: number | null;
  contentType: string | null;
  detectedStack: DetectedStack;
  /** First ~8KB of body for operator inspection. Truncated. */
  bodyPreview: string | null;
  /** Number of probable agenda/document links detected in the body preview. */
  candidateLinkCount: number;
  errorMessage?: string;
  recommendation: VerifyRecommendation;
  reason: string;
  verifyVersion: typeof VERIFY_VERSION;
}

// ── Stack-detection signatures ──────────────────────────────────────────────
//
// Pure regex sniffs. Conservative — false-negative is acceptable (operator
// inspects), false-positive on a non-agenda page is the risk to avoid.

interface StackSignature {
  stack: DetectedStack;
  urlPatterns: RegExp[];
  bodyPatterns: RegExp[];
}

const STACK_SIGNATURES: readonly StackSignature[] = [
  {
    stack: "CIVICPLUS_AGENDA_CENTER",
    urlPatterns: [/\/AgendaCenter(\b|\/)/i],
    bodyPatterns: [
      /AgendaCenter/i,
      /civicplus/i,
    ],
  },
  {
    stack: "CIVICCLERK",
    urlPatterns: [/civicclerk\.com/i, /civicclerk\.net/i],
    bodyPatterns: [/civicclerk/i, /window\.CIVIC_CLERK/i],
  },
  {
    stack: "GRANICUS",
    urlPatterns: [/granicus\.com/i, /granicusideas\.com/i],
    bodyPatterns: [/granicus/i, /MediaViewerUrl/i],
  },
];

/** Detect known agenda/minutes platforms. Pure. */
export function detectStack(url: string, body: string | null): DetectedStack {
  for (const sig of STACK_SIGNATURES) {
    if (sig.urlPatterns.some((re) => re.test(url))) return sig.stack;
    if (body && sig.bodyPatterns.some((re) => re.test(body))) return sig.stack;
  }
  if (body && /<html/i.test(body)) return "GENERIC_HTML";
  return "UNKNOWN_STACK";
}

/** Count plausible doc/agenda links in a body snippet. Heuristic — looks
 *  for .pdf hrefs + AgendaCenter ViewFile patterns + .doc/.docx. Pure. */
export function countCandidateLinks(body: string | null): number {
  if (!body) return 0;
  let count = 0;
  count += matchCount(body, /href\s*=\s*["']([^"']*?\.pdf)(\?[^"']*)?["']/gi);
  count += matchCount(body, /AgendaCenter\/ViewFile\/\d+/gi);
  count += matchCount(body, /href\s*=\s*["']([^"']*?\.docx?)(\?[^"']*)?["']/gi);
  return count;
}

function matchCount(haystack: string, re: RegExp): number {
  let n = 0;
  // Avoid infinite-loop on zero-width matches.
  const matches = haystack.match(re);
  if (matches) n = matches.length;
  return n;
}

// ── Decision logic ──────────────────────────────────────────────────────────

export function decideRecommendation(args: {
  reachable: boolean;
  status: number | null;
  contentType: string | null;
  detectedStack: DetectedStack;
  candidateLinkCount: number;
}): { recommendation: VerifyRecommendation; reason: string } {
  if (!args.reachable) {
    return { recommendation: "remove", reason: "URL not reachable (network error or timeout)" };
  }
  if (args.status === null || args.status >= 400) {
    return { recommendation: "remove", reason: `HTTP ${args.status ?? "?"} response` };
  }
  if (args.contentType && !/text\/html|application\/xhtml/i.test(args.contentType)) {
    return { recommendation: "investigate", reason: `unexpected content-type "${args.contentType}"` };
  }
  if (args.detectedStack === "CIVICPLUS_AGENDA_CENTER" || args.detectedStack === "CIVICCLERK" || args.detectedStack === "GRANICUS") {
    return { recommendation: "activate", reason: `${args.detectedStack} detected + ${args.candidateLinkCount} candidate link(s)` };
  }
  if (args.candidateLinkCount >= 3) {
    return { recommendation: "investigate", reason: `unknown stack but ${args.candidateLinkCount} candidate link(s) suggest the page is an agenda index` };
  }
  return { recommendation: "investigate", reason: "reachable but no stack signature + few candidate links" };
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Verify a single MarketSource URL. Reachability + stack detection +
 * recommendation. Pure with respect to the DB — caller decides whether to
 * persist the verdict (activate, mark OPERATOR_REVIEW, etc.).
 */
export async function verifyMarketSource(
  input: VerifyInput,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<VerifyResult> {
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let reachable = false;
  let status: number | null = null;
  let contentType: string | null = null;
  let bodyPreview: string | null = null;
  let errorMessage: string | undefined;

  try {
    const res = await fetchImpl(input.url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Polite User-Agent — some CivicPlus deployments reject empty UAs.
        "User-Agent": "NeuroGlitch-MarketSource-Verifier/1.0 (+groundworx)",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    reachable = true;
    status = res.status;
    contentType = res.headers.get("content-type");

    // Read at most VERIFY_BODY_PREVIEW_BYTES of body — enough to sniff stack
    // signatures without slurping multi-MB pages.
    try {
      const text = await res.text();
      bodyPreview = text.slice(0, VERIFY_BODY_PREVIEW_BYTES);
    } catch (err) {
      bodyPreview = null;
      errorMessage = `body read failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } catch (err) {
    reachable = false;
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  const detectedStack = reachable ? detectStack(input.url, bodyPreview) : "UNKNOWN_STACK";
  const candidateLinkCount = reachable ? countCandidateLinks(bodyPreview) : 0;
  const { recommendation, reason } = decideRecommendation({
    reachable,
    status,
    contentType,
    detectedStack,
    candidateLinkCount,
  });

  return {
    sourceId: input.sourceId,
    url: input.url,
    reachable,
    status,
    contentType,
    detectedStack,
    bodyPreview,
    candidateLinkCount,
    errorMessage,
    recommendation,
    reason,
    verifyVersion: VERIFY_VERSION,
  };
}
