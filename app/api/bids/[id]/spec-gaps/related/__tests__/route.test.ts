import { beforeEach, describe, expect, test, vi } from "vitest";

type FakeSection = {
  id: number;
  csiNumber: string;
  csiTitle: string;
  csiCanonicalTitle: string | null;
  covered: boolean;
  aiExtractions: string | null;
};

const h = vi.hoisted(() => ({
  sections: [] as FakeSection[],
  hasSpecBook: true,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    specBook: {
      findFirst: vi.fn(async () => {
        if (!h.hasSpecBook) return null;
        return { sections: h.sections.filter((s) => !s.covered) };
      }),
    },
  },
}));

import { GET } from "../route";

const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  h.sections = [
    {
      id: 1,
      csiNumber: "03 30 00",
      csiTitle: "Cast-in-Place Concrete",
      csiCanonicalTitle: null,
      covered: false,
      aiExtractions: JSON.stringify({ submittals: ["Mix design", "Test reports"] }),
    },
    {
      id: 2,
      csiNumber: "07 92 00",
      csiTitle: "Joint Sealants",
      csiCanonicalTitle: null,
      covered: false,
      aiExtractions: null,
    },
    {
      id: 3,
      csiNumber: "08 11 13",
      csiTitle: "Hollow Metal Doors and Frames",
      csiCanonicalTitle: null,
      covered: true,  // covered — must be excluded
      aiExtractions: null,
    },
    {
      id: 4,
      csiNumber: "09 91 23",
      csiTitle: "Interior Painting",
      csiCanonicalTitle: null,
      covered: false,
      aiExtractions: null,
    },
  ];
  h.hasSpecBook = true;
});

describe("GET /api/bids/[id]/spec-gaps/related", () => {
  test("400 on non-numeric id", async () => {
    const res = await GET(new Request("http://t/?q=concrete"), p("abc"));
    expect(res.status).toBe(400);
  });

  test("empty result when q is missing or whitespace-only", async () => {
    const r1 = await GET(new Request("http://t/"), p("1"));
    expect((await r1.json() as { total: number }).total).toBe(0);

    const r2 = await GET(new Request("http://t/?q=   "), p("1"));
    expect((await r2.json() as { total: number }).total).toBe(0);
  });

  test("empty result when q has only short words (< 4 chars)", async () => {
    const res = await GET(new Request("http://t/?q=the an of"), p("1"));
    expect((await res.json() as { total: number }).total).toBe(0);
  });

  test("empty result when no SpecBook exists for bid", async () => {
    h.hasSpecBook = false;
    const res = await GET(new Request("http://t/?q=concrete"), p("1"));
    const json = await res.json() as { sections: unknown[]; total: number };
    expect(json.sections).toHaveLength(0);
    expect(json.total).toBe(0);
  });

  test("returns matching uncovered sections only", async () => {
    const res = await GET(new Request("http://t/?q=concrete"), p("1"));
    const json = await res.json() as { sections: Array<{ id: number }>; total: number };
    expect(json.total).toBe(1);
    expect(json.sections[0].id).toBe(1);
  });

  test("covered section is excluded even when its title matches", async () => {
    h.sections.push({
      id: 99,
      csiNumber: "03 40 00",
      csiTitle: "Precast Concrete",
      csiCanonicalTitle: null,
      covered: true,
      aiExtractions: null,
    });
    const res = await GET(new Request("http://t/?q=concrete"), p("1"));
    const json = await res.json() as { sections: Array<{ id: number }> };
    expect(json.sections.map((s) => s.id)).not.toContain(99);
  });

  test("submittalsCount populated from aiExtractions", async () => {
    const res = await GET(new Request("http://t/?q=concrete"), p("1"));
    const json = await res.json() as { sections: Array<{ submittalsCount: number }> };
    expect(json.sections[0].submittalsCount).toBe(2);
  });

  test("section with no aiExtractions gets submittalsCount 0", async () => {
    const res = await GET(new Request("http://t/?q=painting"), p("1"));
    const json = await res.json() as { sections: Array<{ submittalsCount: number }> };
    expect(json.sections[0].submittalsCount).toBe(0);
  });

  test("respects limit param, reports full total", async () => {
    for (let i = 10; i < 20; i++) {
      h.sections.push({
        id: i,
        csiNumber: `0${i} 00 00`,
        csiTitle: `Concrete Reinforcing Section ${i}`,
        csiCanonicalTitle: null,
        covered: false,
        aiExtractions: null,
      });
    }
    const res = await GET(new Request("http://t/?q=concrete&limit=3"), p("1"));
    const json = await res.json() as { sections: unknown[]; total: number };
    expect(json.sections.length).toBe(3);
    expect(json.total).toBeGreaterThan(3);
  });

  test("higher-score sections ranked before lower-score ones", async () => {
    h.sections.push({
      id: 5,
      csiNumber: "09 91 00",
      csiTitle: "Painting and Coating",
      csiCanonicalTitle: null,
      covered: false,
      aiExtractions: null,
    });
    // q="interior painting": id=4 ("Interior Painting") matches both tokens → score 2
    //                        id=5 ("Painting and Coating") matches "painting" only → score 1
    const res = await GET(new Request("http://t/?q=interior+painting"), p("1"));
    const json = await res.json() as { sections: Array<{ id: number }> };
    const ids = json.sections.map((s) => s.id);
    expect(ids.indexOf(4)).toBeLessThan(ids.indexOf(5));
  });

  test("limit clamped to max 20", async () => {
    for (let i = 100; i < 130; i++) {
      h.sections.push({
        id: i,
        csiNumber: `${i} 00 00`,
        csiTitle: `Concrete Work ${i}`,
        csiCanonicalTitle: null,
        covered: false,
        aiExtractions: null,
      });
    }
    const res = await GET(new Request("http://t/?q=concrete&limit=99"), p("1"));
    const json = await res.json() as { sections: unknown[] };
    expect(json.sections.length).toBeLessThanOrEqual(20);
  });
});
