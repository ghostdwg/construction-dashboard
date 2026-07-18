const GC_REVIEW_UPDATE_FIELDS = new Set([
  "gcReview",
  "gcReviewBy",
  "gcReviewAt",
  "gcCommentary",
]);

export function assertTradeResponseRevisionPatch(data: Record<string, unknown>): void {
  if (Object.keys(data).some((key) => !GC_REVIEW_UPDATE_FIELDS.has(key))) {
    throw new Error("TradeResponseRevision response content is immutable: submit a new revision");
  }
}

const TOKEN_UPDATE_FIELDS = new Set(["lastUsedAt", "revokedAt"]);

export function assertResponseAccessTokenPatch(data: Record<string, unknown>): void {
  if (Object.keys(data).some((key) => !TOKEN_UPDATE_FIELDS.has(key))) {
    throw new Error("ResponseAccessToken credential scope is immutable: rotate or revoke the token");
  }
}
