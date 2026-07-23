import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const pageSource = fs.readFileSync(
  path.join(process.cwd(), "app/(authenticated)/bids/[id]/page.tsx"),
  "utf8",
);

describe("Bid detail server-loader authorization", () => {
  test("authenticates before the first Bid query and scopes that query to the caller", () => {
    const authIndex = pageSource.indexOf("const user = await getUser()");
    const bidQueryIndex = pageSource.indexOf("const bid = await prisma.bid.findFirst");

    expect(authIndex).toBeGreaterThan(-1);
    expect(bidQueryIndex).toBeGreaterThan(authIndex);
    expect(pageSource).toContain("if (!user) redirect(");
    expect(pageSource).toContain("where: { id: bidId, ...bidScopeFilter(user) }");
    expect(pageSource).toContain("if (!bid) notFound()");
  });

  test("renders the versioned Reference workspace only behind the bid authorization boundary", () => {
    const authorizedBidIndex = pageSource.indexOf("if (!bid) notFound()");
    const sectionsIndex = pageSource.indexOf("<SpecSectionsTab");
    const requirementsIndex = pageSource.indexOf("<SpecRequirementsTab");
    const versionsIndex = pageSource.indexOf("<SpecVersionsTab");

    expect(authorizedBidIndex).toBeGreaterThan(-1);
    expect(sectionsIndex).toBeGreaterThan(authorizedBidIndex);
    expect(requirementsIndex).toBeGreaterThan(authorizedBidIndex);
    expect(versionsIndex).toBeGreaterThan(authorizedBidIndex);
    expect(pageSource).toContain('tab === "spec-sections"');
    expect(pageSource).toContain('tab === "spec-requirements"');
    expect(pageSource).toContain('tab === "spec-addenda"');
  });
});
