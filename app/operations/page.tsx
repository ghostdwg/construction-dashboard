// GWX-R1 operations-route-fix — the sidebar's "Operations" destination.
//
// app/page.tsx (bare "/") is the same Operations dashboard, but an
// authenticated visitor never lands there: proxy.ts redirects authenticated
// "/" requests to "/bids" (Part 4 — /  stays the public marketing landing
// page). Re-exporting the dashboard here gives Operations a stable,
// authenticated-reachable URL that doesn't converge with Projects.
export { default } from "../page";
