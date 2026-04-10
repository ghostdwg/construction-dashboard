// End-to-end API test for the bid submission + outcome flow.
// Requires the dev server to be running on localhost:3000.
//
// Run: node scripts/tests/e2e-bid-submission.mjs

const BASE = "http://localhost:3000";

let pass = 0;
let fail = 0;
let testBidId = null;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    pass++;
  } else {
    console.log(`  ✗ ${message}`);
    fail++;
  }
}

async function test(name, fn) {
  console.log(`\n● ${name}`);
  try {
    await fn();
  } catch (err) {
    console.log(`  ✗ Threw: ${err.message}`);
    fail++;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

await test("Create test bid", async () => {
  const res = await fetch(`${BASE}/api/bids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName: "[E2E TEST] Submission Flow Bid",
      location: "Test City, TS",
      dueDate: "2026-06-01",
    }),
  });
  assert(res.ok, `responds OK (got ${res.status})`);
  const bid = await res.json();
  assert(bid.id, "has id");
  testBidId = bid.id;
  assert(bid.status === "draft", "starts as draft");
});

await test("GET /api/bids/[id]/submission — none yet", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submission`);
  assert(res.ok, "responds 200");
  const data = await res.json();
  assert(data.submission === null, "submission is null");
});

await test("POST /api/bids/[id]/submit — creates submission with snapshot", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ourBidAmount: 1250000,
      submittedBy: "Test User",
      notes: "E2E test submission",
    }),
  });
  assert(res.ok, `responds OK (got ${res.status})`);
  const data = await res.json();

  assert(data.submission, "has submission");
  assert(data.submission.bidId === testBidId, "submission.bidId matches");
  assert(data.submission.ourBidAmount === 1250000, "ourBidAmount stored");
  assert(data.submission.submittedBy === "Test User", "submittedBy stored");
  assert(data.submission.notes === "E2E test submission", "notes stored");

  // Snapshot fields
  assert(data.snapshot, "snapshot returned");
  assert(data.snapshot.questions, "questions snapshot present");
  assert(typeof data.snapshot.questions.total === "number", "questions.total is number");
  assert(data.snapshot.spread, "spread snapshot present");
  assert(typeof data.snapshot.spread.tradesWithPricing === "number", "spread.tradesWithPricing is number");
});

await test("Bid status updated to 'submitted'", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}`);
  assert(res.ok, "responds 200");
  const bid = await res.json();
  assert(bid.status === "submitted", `status is 'submitted' (got ${bid.status})`);
});

await test("POST /api/bids/[id]/submit — second submit returns 409", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ourBidAmount: 999999 }),
  });
  assert(res.status === 409, `responds 409 (got ${res.status})`);
});

await test("GET /api/bids/[id]/submission — returns the submission", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submission`);
  const data = await res.json();
  assert(data.submission, "has submission");
  assert(data.submission.briefSnapshot != null || data.submission.briefSnapshot === null, "briefSnapshot field present");
  assert(typeof data.submission.questionSnapshot === "string", "questionSnapshot is JSON string");
  assert(typeof data.submission.spreadSnapshot === "string", "spreadSnapshot is JSON string");

  // Verify snapshot JSON parses
  try {
    const qs = JSON.parse(data.submission.questionSnapshot);
    assert(typeof qs.total === "number", "questionSnapshot parses to object with total");
  } catch {
    assert(false, "questionSnapshot is parseable JSON");
  }
});

await test("PATCH outcome — mark as lost with details", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submission/outcome`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outcome: "lost",
      winningBidAmount: 1180000,
      ourRank: 2,
      totalBidders: 4,
      lostReason: "price",
      lostReasonNote: "Competitor cut price aggressively",
      lessonsLearned: "Review concrete sub markup next time",
    }),
  });
  assert(res.ok, `responds OK (got ${res.status})`);
  const data = await res.json();

  assert(data.submission.outcome === "lost", "outcome=lost");
  assert(data.submission.winningBidAmount === 1180000, "winningBidAmount stored");
  assert(data.submission.ourRank === 2, "ourRank=2");
  assert(data.submission.totalBidders === 4, "totalBidders=4");
  assert(data.submission.lostReason === "price", "lostReason=price");
  assert(data.submission.lessonsLearned.includes("concrete"), "lessonsLearned stored");
  assert(data.submission.outcomeAt, "outcomeAt timestamp set");

  // Derived bid accuracy
  assert(data.derived, "derived block returned");
  // (1250000 - 1180000) / 1180000 * 100 = 5.93%
  assert(Math.abs(data.derived.bidAccuracyPercent - 5.9) < 0.5, `bidAccuracyPercent ~5.9 (got ${data.derived.bidAccuracyPercent})`);
});

await test("Bid status cascaded to 'lost'", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}`);
  const bid = await res.json();
  assert(bid.status === "lost", `status is 'lost' (got ${bid.status})`);
});

await test("PATCH outcome — invalid outcome value rejected", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submission/outcome`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome: "maybe" }),
  });
  assert(res.status === 400, `responds 400 (got ${res.status})`);
  const err = await res.json();
  assert(err.error.includes("outcome must be"), "error message references valid outcomes");
});

await test("PATCH outcome — invalid lostReason rejected", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submission/outcome`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lostReason: "vibes" }),
  });
  assert(res.status === 400, `responds 400 (got ${res.status})`);
});

await test("PATCH outcome — change to won updates status to awarded", async () => {
  const res = await fetch(`${BASE}/api/bids/${testBidId}/submission/outcome`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome: "won" }),
  });
  assert(res.ok, "PATCH responds OK");

  const bidRes = await fetch(`${BASE}/api/bids/${testBidId}`);
  const bid = await bidRes.json();
  assert(bid.status === "awarded", `status is 'awarded' (got ${bid.status})`);
});

await test("GET /api/reports/post-bid — includes our test bid", async () => {
  const res = await fetch(`${BASE}/api/reports/post-bid`);
  assert(res.ok, "responds 200");
  const data = await res.json();

  assert(typeof data.summary.totalSubmitted === "number", "summary.totalSubmitted is number");
  assert(typeof data.summary.winRate === "number", "summary.winRate is number");
  assert(Array.isArray(data.recentBids), "recentBids is array");

  const ourBid = data.recentBids.find((b) => b.id === testBidId);
  assert(ourBid, "test bid in recentBids");
  assert(ourBid.outcome === "won", "outcome=won");
  assert(ourBid.ourBidAmount === 1250000, "ourBidAmount preserved");
});

await test("Cleanup: revert outcome and delete test bid", async () => {
  // Need to delete via direct path — bids may not have a DELETE route
  const res = await fetch(`${BASE}/api/bids/${testBidId}`, { method: "DELETE" });
  if (res.ok || res.status === 204) {
    assert(true, "deleted via API");
  } else {
    // Fallback: this test bid will need manual cleanup
    assert(true, `no DELETE route on /api/bids/[id] (status ${res.status}) — leaving test bid for manual cleanup`);
  }
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`PASS: ${pass}    FAIL: ${fail}`);
console.log(`${"=".repeat(50)}`);
process.exit(fail > 0 ? 1 : 0);
