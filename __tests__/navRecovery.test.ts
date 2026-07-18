import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Regression guards for GWX-R1 staging nav recovery. Root cause: app/layout.tsx's
// <main> carried a `marginLeft: var(--sidebar-width)` (added in 413297c) on top
// of the flexbox layout that already reserves the sidebar's space at >=768px
// (.gwx-rail is position:static there — see app/globals.css). That double-counted
// the offset on desktop and unconditionally shifted every page's content on
// mobile, including the per-bid phase/sub-tab nav in ProjectContextBar.tsx, even
// with the drawer fully off-canvas.

describe("app/layout.tsx main content area", () => {
  const layout = readFileSync(join(__dirname, "..", "app", "layout.tsx"), "utf8");

  it("does not re-apply --sidebar-width as a marginLeft on <main>", () => {
    // AppSidebar's <aside> is a real flex sibling at desktop widths and
    // fixed/off-canvas on mobile; either way <main> must not add its own
    // matching offset, or content gets pushed twice (desktop) or shifted
    // even when the drawer is closed (mobile).
    expect(layout).not.toMatch(/marginLeft.*sidebar-width/);
  });

  it("computes a topbar-height CSS var that accounts for the env banner", () => {
    // The mobile hamburger and the rail's fixed `top` anchor to this value
    // instead of a hardcoded 62px, which only happened to be correct in
    // production (the only tier where EnvironmentBanner renders nothing).
    expect(layout).toMatch(/TOPBAR_HEIGHT\s*=\s*62\s*\+\s*getBannerHeight\(env\.APP_ENV\)/);
    expect(layout).toMatch(/--topbar-h/);
  });

  it("constrains the application shell to the viewport and scrolls main independently", () => {
    expect(layout).toMatch(/<body[\s\S]*className="[^"]*h-dvh[^"]*overflow-hidden/);
    expect(layout).toMatch(/<main className="[^"]*overflow-y-auto[^"]*"/);
    expect(layout).toMatch(/<main className="[^"]*overflow-x-hidden[^"]*"/);
  });
});

describe("app/globals.css .gwx-rail mobile anchor", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

  it("anchors top to the topbar-height var, not a hardcoded 62px", () => {
    expect(css).toMatch(/\.gwx-rail\s*\{[^}]*top:\s*var\(--topbar-h,\s*62px\)/);
  });

  it("still falls back to 64/240 sidebar width — unaffected by the topbar-h fix", () => {
    expect(css).toMatch(/--sidebar-width:\s*64px/);
  });

  it("hides the closed mobile rail from focus while keeping it visible on desktop", () => {
    expect(css).toMatch(/\.gwx-rail\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toMatch(/\.gwx-rail\.gwx-rail-open\s*\{[^}]*visibility:\s*visible/);
    expect(css).toMatch(/@media \(min-width:\s*768px\)[\s\S]*\.gwx-rail\s*\{[^}]*visibility:\s*visible/);
  });
});

describe("app/components/AppSidebar.tsx mobile hamburger", () => {
  const sidebar = readFileSync(
    join(__dirname, "..", "app", "components", "AppSidebar.tsx"),
    "utf8",
  );

  it("anchors below the real topbar height instead of a hardcoded 72px", () => {
    expect(sidebar).toMatch(/top:\s*"calc\(var\(--topbar-h,\s*62px\)\s*\+\s*10px\)"/);
    expect(sidebar).not.toMatch(/top-\[72px\]/);
  });

  it("routes Operations to its stable authenticated destination", () => {
    expect(sidebar).toMatch(/href:\s*"\/operations"[\s\S]*label:\s*"Operations"/);
    expect(sidebar).not.toMatch(/href:\s*"\/"[\s\S]*label:\s*"Operations"/);
  });

  it("exposes and restores focus for the keyboard-operable mobile drawer", () => {
    expect(sidebar).toMatch(/aria-controls="primary-navigation"/);
    expect(sidebar).toMatch(/aria-expanded=\{mobileOpen\}/);
    expect(sidebar).toMatch(/event\.key === "Escape"/);
    expect(sidebar).toMatch(/openButtonRef\.current\?\.focus\(\)/);
  });
});

describe("authenticated Operations route", () => {
  const operationsPage = readFileSync(
    join(__dirname, "..", "app", "operations", "page.tsx"),
    "utf8",
  );

  it("reuses the existing cross-project dashboard at a descriptive route", () => {
    expect(operationsPage).toMatch(/export \{ default \} from "\.\.\/page"/);
    expect(operationsPage).toMatch(/title:\s*"Operations \| GroundworX"/);
  });
});

describe("app/components/EnvironmentBanner.tsx shared height export", () => {
  it("getBannerHeight matches the per-tier banner heights used for rendering", async () => {
    const { getBannerHeight } = await import("../app/components/EnvironmentBanner");
    expect(getBannerHeight("local")).toBe(18);
    expect(getBannerHeight("staging")).toBe(22);
    expect(getBannerHeight("production")).toBe(0);
  });
});

describe("Dockerfile immutable image traceability", () => {
  const dockerfile = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");

  it("declares the three OCI provenance labels in the runner stage", () => {
    expect(dockerfile).toMatch(/ARG IMAGE_REVISION/);
    expect(dockerfile).toMatch(/ARG IMAGE_CREATED/);
    expect(dockerfile).toMatch(/ARG IMAGE_SOURCE/);
    expect(dockerfile).toMatch(/org\.opencontainers\.image\.revision="\$\{IMAGE_REVISION\}"/);
    expect(dockerfile).toMatch(/org\.opencontainers\.image\.created="\$\{IMAGE_CREATED\}"/);
    expect(dockerfile).toMatch(/org\.opencontainers\.image\.source="\$\{IMAGE_SOURCE\}"/);
  });
});
