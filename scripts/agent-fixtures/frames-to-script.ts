import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  acpNotificationToEvents,
  acpPermissionRequestToPrompt,
} from "@/agentMode/acp/wireTranslate";
import { PermissionBridge } from "@/agentMode/sdk/permissionBridge";
import { createTranslatorState, translateSdkMessage } from "@/agentMode/sdk/sdkMessageTranslator";
import type { ScriptStep, SessionScript } from "@/agentMode/session/host/sessionScript";
import type { PermissionPrompt, SessionUpdate, StopReason } from "@/agentMode/session/types";

interface Frame {
  dir: string;
  tag: string;
  kind: string;
  method: string;
  id: string | null;
  payload: Record<string, unknown>;
}

const PROMPT_METHODS = new Set(["prompt", "session/prompt"]);
const DROPPED_UPDATES = new Set([
  "state_changed",
  "config_option_update",
  "current_mode_update",
  "session_info_update",
]);
const VERBATIM_KEYS = new Set([
  "sessionUpdate",
  "type",
  "kind",
  "status",
  "priority",
  "stopReason",
  "toolKind",
  "optionId",
  "vendorToolName",
]);

function readFrames(text: string, tag: string): Frame[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Frame)
    .filter((frame) => frame.tag === tag);
}

function segments(frames: Frame[]): Frame[][] {
  const out: Frame[][] = [];
  let open: Frame[] | null = null;
  let startId: string | null = null;
  for (const frame of frames) {
    if (
      !open &&
      frame.dir === "→" &&
      frame.kind === "request" &&
      PROMPT_METHODS.has(frame.method)
    ) {
      open = [frame];
      startId = frame.id;
    } else if (open) {
      open.push(frame);
      if (
        (frame.kind === "result" || frame.kind === "error") &&
        PROMPT_METHODS.has(frame.method) &&
        frame.id === startId
      ) {
        out.push(open);
        open = null;
      }
    }
  }
  return out;
}

function pseudoWord(word: string): string {
  let hash = 2166136261;
  for (const ch of word) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < word.length; i++) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    out += "abcdefghijklmnopqrstuvwxyz"[hash % 26];
  }
  return out;
}

function pseudo(text: string): string {
  return text.replace(/\S+/g, pseudoWord);
}

class Sanitizer {
  private aliases = new Map<string, string>();

  private alias(value: string): string {
    if (!this.aliases.has(value)) this.aliases.set(value, `id-${this.aliases.size + 1}`);
    return this.aliases.get(value)!;
  }

  clean(value: unknown, key = ""): unknown {
    if (typeof value === "string") {
      if (VERBATIM_KEYS.has(key) && !value.startsWith("mcp__")) return value;
      if (/Id$/.test(key) || key === "id") return this.alias(value);
      return pseudo(value);
    }
    if (Array.isArray(value)) return value.map((item) => this.clean(item, key));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "_meta" || k === "sessionId" || k === "signal" || v === undefined) continue;
        out[key === "answers" ? pseudo(k) : k] = this.clean(v, k);
      }
      return out;
    }
    return value;
  }
}

function promptText(frame: Frame): string {
  const prompt = frame.payload.prompt;
  if (typeof prompt === "string") return prompt;
  return (prompt as { type: string; text?: string }[])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function allowOption(prompt: PermissionPrompt, allow: boolean): string {
  const kinds = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  return prompt.options.find((o) => kinds.includes(o.kind))?.optionId ?? prompt.options[0].optionId;
}

async function convertSegment(
  frames: Frame[],
  backendId: string,
  name: string
): Promise<SessionScript> {
  const steps: ScriptStep[] = [{ step: "send", text: promptText(frames[0]) }];
  const sanitizer = new Sanitizer();
  const push = (step: ScriptStep) => steps.push(step);
  const pushUpdate = (update: SessionUpdate) => {
    if (DROPPED_UPDATES.has(update.sessionUpdate)) return;
    push({ step: "event", update: sanitizer.clean(update) as SessionUpdate });
  };
  const toolUses: { id: string; name: string; used: boolean }[] = [];
  const translator = createTranslatorState();
  let stopReason: StopReason = "end_turn";
  let cancelled = false;

  const responseFor = (index: number, method: string): Frame | undefined =>
    frames.slice(index + 1).find((f) => f.dir === "→" && f.method === method);

  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    const last = i === frames.length - 1;
    if (last) {
      stopReason = (frame.payload.stopReason as StopReason | undefined) ?? "end_turn";
      break;
    }
    if (backendId === "claude") {
      if (frame.dir !== "←") continue;
      if (frame.method === "canUseTool:request" || frame.method === "askUserQuestion:request") {
        const isQuestion = frame.method === "askUserQuestion:request";
        const reply = responseFor(
          i,
          isQuestion ? "askUserQuestion:response" : "canUseTool:response"
        );
        const toolName = isQuestion ? "AskUserQuestion" : (frame.payload.toolName as string);
        const input = (isQuestion ? frame.payload : frame.payload.input) as Record<string, unknown>;
        const toolUse = toolUses.find((t) => !t.used && t.name === toolName);
        if (toolUse) toolUse.used = true;
        const toolUseID = toolUse?.id ?? `toolu-${i}`;
        const bridge = new PermissionBridge("claude-session", {
          getPrompter: () => async (prompt) => {
            const allow = (reply?.payload.behavior ?? "allow") === "allow";
            const optionId = allowOption(prompt, allow);
            push({
              step: "permission",
              request: sanitizer.clean(prompt) as PermissionPrompt,
              optionId,
            });
            return { outcome: { outcome: "selected", optionId } };
          },
          getAskUserQuestionPrompter: () => async (prompt) => {
            const answers =
              (reply?.payload.updatedInput as { answers?: Record<string, string> })?.answers ?? {};
            push({
              step: "question",
              ...(sanitizer.clean({
                requestId: prompt.requestId,
                questions: prompt.questions,
                answers,
              }) as { requestId: string; questions: []; answers: Record<string, string> }),
            });
            return answers;
          },
        });
        await bridge.canUseTool(toolName, input, {
          signal: new AbortController().signal,
          suggestions: frame.payload.suggestions as never,
          toolUseID,
        } as never);
        continue;
      }
      const message = frame.payload as unknown as SDKMessage;
      if (!["stream_event", "assistant", "user", "system", "result"].includes(message.type))
        continue;
      const streamed = message as {
        type: string;
        event?: { type: string; content_block?: { type: string; id: string; name: string } };
      };
      if (
        streamed.event?.type === "content_block_start" &&
        streamed.event.content_block?.type === "tool_use"
      ) {
        toolUses.push({
          id: streamed.event.content_block.id,
          name: streamed.event.content_block.name,
          used: false,
        });
      }
      for (const event of translateSdkMessage(message, "claude-session", translator)) {
        pushUpdate(event.update);
      }
    } else if (
      frame.dir === "←" &&
      frame.kind === "notif" &&
      frame.method === "session/update" &&
      frame.payload.update
    ) {
      for (const event of acpNotificationToEvents(frame.payload as never)) pushUpdate(event.update);
    } else if (
      frame.dir === "←" &&
      frame.kind === "request" &&
      frame.method === "session/request_permission"
    ) {
      const prompt = acpPermissionRequestToPrompt(frame.payload as never);
      const reply = frames
        .slice(i + 1)
        .find((f) => f.dir === "→" && f.kind === "result" && f.id === frame.id);
      const outcome = (reply?.payload.outcome ?? {}) as { optionId?: string };
      push({
        step: "permission",
        request: sanitizer.clean(prompt) as PermissionPrompt,
        optionId: outcome.optionId ?? allowOption(prompt, true),
      });
    } else if (frame.dir === "→" && frame.method === "session/cancel") {
      cancelled = true;
      push({ step: "cancel" });
    }
  }
  if (stopReason === "cancelled" && !cancelled) push({ step: "cancel" });
  push({ step: "end", stopReason });
  const send = steps[0];
  if (send.step === "send") send.text = pseudo(send.text);
  return { name, backendId, steps };
}

function describe(script: SessionScript): string {
  const count = (fn: (s: ScriptStep) => boolean) => script.steps.filter(fn).length;
  const kinds = new Map<string, number>();
  for (const s of script.steps) {
    if (s.step === "event")
      kinds.set(s.update.sessionUpdate, (kinds.get(s.update.sessionUpdate) ?? 0) + 1);
  }
  return JSON.stringify({
    steps: script.steps.length,
    permissions: count((s) => s.step === "permission"),
    questions: count((s) => s.step === "question"),
    cancel: count((s) => s.step === "cancel"),
    end: script.steps.at(-1),
    events: Object.fromEntries(kinds),
  });
}

export interface ConvertOptions {
  list?: boolean;
  segment?: number;
  name?: string;
}

export async function convert(
  framesText: string,
  backendId: string,
  options: ConvertOptions
): Promise<string> {
  const segs = segments(readFrames(framesText, backendId === "claude" ? "claude-sdk" : backendId));
  if (options.list) {
    const lines: string[] = [];
    for (const [index, seg] of segs.entries()) {
      const script = await convertSegment(seg, backendId, `segment-${index}`);
      lines.push(`${index} ${describe(script)}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const script = await convertSegment(
    segs[options.segment ?? 0],
    backendId,
    options.name ?? "script"
  );
  return `${JSON.stringify(script)}\n`;
}
