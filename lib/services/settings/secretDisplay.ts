// Security hotfix — secret display status.
//
// A secret setting's value (or any fragment of it, including a "last-4"
// suffix) must NEVER reach the client. This module computes a neutral,
// content-free status from `hasValue` + `source` only — never from the
// actual value — so the UI can honestly say WHERE a credential is
// configured without ever rendering (or serializing) any part of it.

export type SecretDisplayStatus = "database" | "environment" | "not-configured";

export function computeSecretDisplayStatus(
  hasValue: boolean,
  source: "db" | "env" | "missing"
): SecretDisplayStatus {
  if (!hasValue || source === "missing") return "not-configured";
  return source === "db" ? "database" : "environment";
}

export function secretDisplayLabel(status: SecretDisplayStatus): string {
  switch (status) {
    case "database":
      return "Configured from database";
    case "environment":
      return "Configured from environment";
    case "not-configured":
      return "not configured";
  }
}
