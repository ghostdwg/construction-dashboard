import { describe, it, expect, vi } from "vitest";
import { createMessage } from "../gateway";

// Offline, mock-only tests for the TypeScript AI gateway (P1B). A fake client
// is injected via the `client` seam — no @anthropic-ai/sdk network call occurs.

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
