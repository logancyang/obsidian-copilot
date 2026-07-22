import fs from "fs";
import path from "path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent, SessionUpdate } from "@/agentMode/session/types";
import { createTranslatorState, translateSdkMessage } from "./sdkMessageTranslator";

interface FixtureFrame {
  tag: string;
  payload: SDKMessage;
}

function readFixture(): FixtureFrame[] {
  const fixturePath = path.join(
    process.cwd(),
    "src/agentMode/sdk/__fixtures__/claude-notification-only-subagents.ndjson"
  );
  return fs
    .readFileSync(fixturePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FixtureFrame);
}

describe("sdkMessageReplay", () => {
  it("preserves notification-only lifecycle ordering at the session-event boundary", () => {
    const frames = readFixture();
    const state = createTranslatorState();
    const events: SessionEvent[] = [];
    const completedLaunches = new Set<string>();

    expect(JSON.stringify(frames)).not.toContain("TaskOutput");
    for (const frame of frames) {
      const translated = translateSdkMessage(frame.payload, "replay-session", state);
      events.push(...translated);
      for (const { update } of translated) {
        if (update.sessionUpdate !== "tool_call_update") continue;
        if (!update.toolCallId.startsWith("launch-")) continue;
        if (update.status === "completed") completedLaunches.add(update.toolCallId);
        if (completedLaunches.has(update.toolCallId)) expect(update.status).not.toBe("in_progress");
      }
    }

    const updates = events.map(({ update }) => update);
    const launches = updates.filter(
      (update): update is Extract<SessionUpdate, { sessionUpdate: "tool_call" }> =>
        update.sessionUpdate === "tool_call" && update.vendorToolName === "Agent"
    );
    expect(launches.map(({ toolCallId }) => toolCallId)).toEqual(["launch-a", "launch-b"]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "launch-a",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "Structure report from the automatic notification." },
          },
        ],
      })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "launch-b",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "Themes report from the automatic notification." },
          },
        ],
      })
    );
    expect(updates).toContainEqual({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Combined final response from both reports." },
    });
  });
});
