import { describe, it, expect, vi, beforeEach } from "vitest";

// Offline, mock-only tests for the TypeScript AI gateway (P1B). A fake client
// is injected via the `client` seam — no @anthropic-ai/sdk network call occurs.
//
// The P2-A0 shadow prompt-scan hook (scanPrompt + emitAuditEventNoAwait) is
// mocked module-wide so these tests can (a) assert exactly what the gateway
// passes to the audit emitter without touching Prisma/stdout, and (b) inject
// synchronous failures from either dependency to prove gateway resilience.
// Mocking these no-ops does not change the pre-existing transparent-relay
// tests below — they only assert on the injected `client`'s calls and the
// returned CreateMessageResult, neither of which the scan touches.

const h = vi.hoisted(() => ({
  scanPrompt: vi.fn(),
  emitAuditEventNoAwait: vi.fn(),
}));

vi.mock("../promptScan", () => ({ scanPrompt: h.scanPrompt }));
vi.mock("@/lib/observability/audit", () => ({ emitAuditEventNoAwait: h.emitAuditEventNoAwait }));

import { createMessage } from "../gateway";

const CLEAN_SCAN = {
  scannerVersion: "1.0.0",
  mode: "shadow" as const,
  findings: [],
  scannedChars: 0,
  truncated: false,
};

function fakeMessage(text: string, input: number, output: number, model = "claude-sonnet-4-6") {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: input, output_tokens: output },
    model,
    stop_reason: "end_turn",
  } as any;
}

function fakeClient(result: { message?: any; error?: any }) {
  const create = vi.fn(async (_params: any) => {
    if (result.error) throw result.error;
    return result.message;
  });
  return { client: { messages: { create } } as any, create };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.scanPrompt.mockReturnValue(CLEAN_SCAN);
});

describe("ai gateway — transparent relay (P1B)", () => {
  it("1. request fidelity: forwards exact params; omits system/temperature when unset", async () => {
    const { client, create } = fakeClient({ message: fakeMessage("hi", 10, 5) });
    await createMessage({
      model: "m1",
      maxTokens: 200,
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      model: "m1",
      max_tokens: 200,
      messages: [{ role: "user", content: "p" }],
    });
  });

  it("1b. request fidelity: includes system when provided, still omits temperature", async () => {
    const { client, create } = fakeClient({ message: fakeMessage("hi", 1, 1) });
    await createMessage({
      model: "m2",
      maxTokens: 50,
      system: "SYS",
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });
    expect(create.mock.calls[0][0].system).toBe("SYS");
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it("2+3. response/usage fidelity: raw object, text, usage, model preserved verbatim", async () => {
    const msg = fakeMessage("hello world", 12, 7, "mX");
    const { client } = fakeClient({ message: msg });
    const r = await createMessage({
      model: "mX",
      maxTokens: 100,
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });
    expect(r.raw).toBe(msg);
    expect(r.text).toBe("hello world");
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect(r.model).toBe("mX");
    expect(r.stopReason).toBe("end_turn");
  });

  it("4. error fidelity: re-throws the original provider error unchanged", async () => {
    const err: any = new Error("overloaded");
    err.status = 529;
    const { client } = fakeClient({ error: err });
    await expect(
      createMessage({
        model: "m",
        maxTokens: 1,
        messages: [{ role: "user", content: "p" }],
        apiKey: "k",
        client,
      })
    ).rejects.toBe(err);
  });
});

describe("ai gateway — P2-A0 shadow prompt-scan hook", () => {
  it("7. normal path: emits one shadow event with metadata-only payload", async () => {
    h.scanPrompt.mockReturnValue({
      scannerVersion: "1.0.0",
      mode: "shadow",
      findings: [{ detector: "dollar_amount", count: 1, confidence: "medium" }],
      scannedChars: 42,
      truncated: false,
    });
    const { client } = fakeClient({ message: fakeMessage("ok", 3, 2) });

    await createMessage({
      model: "m",
      maxTokens: 10,
      system: "SYS TEXT",
      messages: [{ role: "user", content: "USER TEXT" }],
      apiKey: "k",
      client,
      audit: { feature: "gap_analysis", bidId: "42", correlationId: "corr-1" },
    });

    expect(h.emitAuditEventNoAwait).toHaveBeenCalledTimes(1);
    const call = h.emitAuditEventNoAwait.mock.calls[0][0];
    expect(call.category).toBe("ai_prompt_scan");
    expect(call.action).toBe("prompt_scan");
    expect(call.decision).toBe("flagged");
    expect(call.severity).toBe("WARN");
    expect(call.actor).toEqual({ kind: "system" });
    expect(call.correlationId).toBe("corr-1");
    expect(call.subject).toEqual({ kind: "BID", id: "42" });
    expect(call.payload).toEqual({
      scannerVersion: "1.0.0",
      mode: "shadow",
      feature: "gap_analysis",
      model: "m",
      findings: [{ detector: "dollar_amount", count: 1, confidence: "medium" }],
      scannedChars: 42,
      truncated: false,
    });
  });

  it("7b. clean scan emits decision=clean, severity=DEBUG", async () => {
    const { client } = fakeClient({ message: fakeMessage("ok", 1, 1) });
    await createMessage({
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });
    const call = h.emitAuditEventNoAwait.mock.calls[0][0];
    expect(call.decision).toBe("clean");
    expect(call.severity).toBe("DEBUG");
  });

  it("default feature is 'unknown' when audit metadata is absent", async () => {
    const { client } = fakeClient({ message: fakeMessage("ok", 1, 1) });
    await createMessage({
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });
    const call = h.emitAuditEventNoAwait.mock.calls[0][0];
    expect(call.payload.feature).toBe("unknown");
    expect(call.subject).toBeNull();
  });

  it("concatenates system + text-only message blocks; skips non-text blocks", async () => {
    const { client } = fakeClient({ message: fakeMessage("ok", 1, 1) });
    await createMessage({
      model: "m",
      maxTokens: 10,
      system: "SYSTEM PART",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "TEXT PART" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } } as any,
          ],
        },
      ],
      apiKey: "k",
      client,
    });
    expect(h.scanPrompt).toHaveBeenCalledWith("SYSTEM PART\nTEXT PART");
  });

  it("6a. scanner failure never changes provider request/response/usage/caller result", async () => {
    h.scanPrompt.mockImplementation(() => {
      throw new Error("scanner exploded");
    });
    const msg = fakeMessage("hello world", 12, 7, "mX");
    const { client, create } = fakeClient({ message: msg });

    const r = await createMessage({
      model: "mX",
      maxTokens: 100,
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });

    expect(create.mock.calls[0][0]).toEqual({
      model: "mX",
      max_tokens: 100,
      messages: [{ role: "user", content: "p" }],
    });
    expect(r.raw).toBe(msg);
    expect(r.text).toBe("hello world");
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 7 });

    // Failure is surfaced as scan_error, not silently dropped.
    const call = h.emitAuditEventNoAwait.mock.calls.find(
      (c: any) => c[0].decision === "scan_error"
    );
    if (!call) throw new Error("expected a scan_error audit event to have been emitted");
    expect(call[0].severity).toBe("ERROR");
    expect(call[0].payload).toEqual({ feature: "unknown", model: "mX" });
  });

  it("6b. audit-emission failure never changes provider request/response/usage/caller result", async () => {
    h.emitAuditEventNoAwait.mockImplementation(() => {
      throw new Error("audit emitter exploded");
    });
    const msg = fakeMessage("hello world", 12, 7, "mX");
    const { client, create } = fakeClient({ message: msg });

    const r = await createMessage({
      model: "mX",
      maxTokens: 100,
      messages: [{ role: "user", content: "p" }],
      apiKey: "k",
      client,
    });

    expect(create.mock.calls[0][0]).toEqual({
      model: "mX",
      max_tokens: 100,
      messages: [{ role: "user", content: "p" }],
    });
    expect(r.raw).toBe(msg);
    expect(r.text).toBe("hello world");
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    // No throw escapes createMessage even though every emit call throws.
  });

  it("5. leak safety: a flagged finding's audit payload never contains matched text or raw prompt content", async () => {
    h.scanPrompt.mockReturnValue({
      scannerVersion: "1.0.0",
      mode: "shadow",
      findings: [{ detector: "email", count: 1, confidence: "low" }],
      scannedChars: 30,
      truncated: false,
    });
    const secretEmail = "definitely-not-real@example.com";
    const { client } = fakeClient({ message: fakeMessage("ok", 1, 1) });

    await createMessage({
      model: "m",
      maxTokens: 10,
      system: `Contact ${secretEmail} please`,
      messages: [{ role: "user", content: "irrelevant" }],
      apiKey: "k",
      client,
    });

    const call = h.emitAuditEventNoAwait.mock.calls[0][0];
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain(secretEmail);
    expect(serialized).not.toContain("Contact");
    expect(serialized).not.toContain("irrelevant");
  });
});
