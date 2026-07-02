// governance/guardrails/selftest.mjs
//
// Lightweight, network-free self-test for the guardrail detection rules.
// Feeds inline sample lines to the exported rule sets and asserts that each
// rule matches what it should and does NOT match safe lines. No filesystem
// scanning of the repo, no external services.
//
// Run: node governance/guardrails/selftest.mjs   (exits non-zero on failure)

import { TS_RULES, PY_RULES } from "./detect-ai-providers.mjs";
import { ACTIVATION_RULES } from "./detect-deploy-storage.mjs";

let failures = 0;
function check(name, cond) {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${name}`);
  } else {
    console.log(`  ok:   ${name}`);
  }
}
const hits = (rules, line) => rules.filter((r) => r.re.test(line)).map((r) => r.id);

console.log("== guardrail selftest ==");

// TS positive
check("TS new Anthropic", hits(TS_RULES, "const c = new Anthropic({ apiKey });").includes("anthropic-client"));
check("TS anthropic import", hits(TS_RULES, "import Anthropic from '@anthropic-ai/sdk'").includes("anthropic-import"));
check("TS new OpenAI", hits(TS_RULES, "const o = new OpenAI({});").includes("openai-client"));
check("TS messages.create", hits(TS_RULES, "await client.messages.create({ model })").includes("direct-model-call"));
check("TS assemblyai url", hits(TS_RULES, "fetch('https://api.assemblyai.com/v2/upload')").includes("assemblyai"));
// TS negative (safe lines must NOT trip)
check("TS safe: gateway call", hits(TS_RULES, "await aiGateway.run(request)").length === 0);
check("TS safe: env name only", hits(TS_RULES, "const k = process.env.ANTHROPIC_API_KEY;").length === 0);

// PY positive
check("PY anthropic.Anthropic", hits(PY_RULES, "client = anthropic.Anthropic(api_key=key)").includes("anthropic-client"));
check("PY import anthropic", hits(PY_RULES, "import anthropic").includes("anthropic-import"));
check("PY assemblyai base", hits(PY_RULES, 'ASSEMBLYAI_BASE = "https://api.assemblyai.com"').includes("assemblyai"));
// PY negative
check("PY safe: comment", hits(PY_RULES, "# call the ai gateway here").length === 0);

// Deploy/storage positive
check("fly deploy cmd", hits(ACTIVATION_RULES, "flyctl deploy --config runtime/fly/fly.toml").includes("fly-deploy-cmd"));
check("s3 backend selected", hits(ACTIVATION_RULES, "STORAGE_BACKEND=s3").includes("s3-backend-selected"));
check("new S3BlobStore", hits(ACTIVATION_RULES, "return new S3BlobStore(cfg);").includes("s3blobstore-usage"));
check("aws sdk import", hits(ACTIVATION_RULES, "import { S3Client } from '@aws-sdk/client-s3'").includes("cloud-storage-sdk"));
// Deploy/storage negative
check("local backend safe", hits(ACTIVATION_RULES, "const backend = process.env.STORAGE_BACKEND || 'local';").length === 0);
check("s3blobstore comment safe", hits(ACTIVATION_RULES, " * ...and (future) S3BlobStore.").length === 0);

console.log(`\nselftest: ${failures === 0 ? "PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
