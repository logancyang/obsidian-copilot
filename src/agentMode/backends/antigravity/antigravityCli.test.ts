import { parseAntigravityModels, parseAntigravityStreamLine } from "./antigravityCli";

describe("parseAntigravityModels", () => {
  it("parses model slugs and display names while ignoring diagnostics", () => {
    const output = [
      "Antigravity models",
      "gemini-3.7-flash-high  Gemini 3.7 Flash (High)",
      "claude-sonnet-4-6\tClaude Sonnet 4.6",
      "[info] loaded cached credentials",
      "",
    ].join("\n");

    expect(parseAntigravityModels(output)).toEqual([
      { modelId: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
      { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ]);
  });
});

describe("parseAntigravityStreamLine", () => {
  it("extracts text deltas from step updates", () => {
    expect(
      parseAntigravityStreamLine(
        JSON.stringify({ event: "step_update", step_update: { text_delta: "hello" } })
      )
    ).toEqual({ kind: "step_update", textDelta: "hello" });
  });

  it("extracts successful and failed result metadata", () => {
    expect(
      parseAntigravityStreamLine(
        JSON.stringify({
          event: "result",
          status: "completed",
          response: "hello",
          conversation_id: "conv-1",
          usage: { input_tokens: 3, output_tokens: 4 },
        })
      )
    ).toEqual({
      kind: "result",
      status: "completed",
      response: "hello",
      conversationId: "conv-1",
      usage: { input_tokens: 3, output_tokens: 4 },
    });

    expect(
      parseAntigravityStreamLine(
        JSON.stringify({ event: "result", status: "error", response: "nope" })
      )
    ).toEqual({ kind: "result", status: "error", response: "nope" });
  });

  it("ignores malformed and unsupported lines", () => {
    expect(parseAntigravityStreamLine("not json")).toBeNull();
    expect(parseAntigravityStreamLine(JSON.stringify({ event: "heartbeat" }))).toBeNull();
  });
});
