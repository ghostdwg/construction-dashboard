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
});
