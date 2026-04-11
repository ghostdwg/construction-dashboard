// Legacy /settings/ai-tokens URL — redirects to the new SET1 settings shell.
// The AI configuration card includes everything that used to live here.

import { redirect } from "next/navigation";

export default function LegacyAiTokensRedirect(): never {
  redirect("/settings?section=ai");
}
