import type { Metadata } from "next";

// Authenticated visits to the bare root are redirected to Projects by the
// proxy. Keep the cross-project Operations dashboard at a stable route rather
// than sending the sidebar through that landing-page redirect.
export const metadata: Metadata = {
  title: "Operations | GroundworX",
};

export { default } from "../page";
