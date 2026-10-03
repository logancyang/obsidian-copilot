import type { CompanionWireFrame } from "./wire";
import { prependCopilotInstructions, stripCopilotInstructions } from "./instructions";
import { nativePlanResult, planPermission } from "./plan";
import { spawnCli } from "./platform";
import { createInterface } from "node:readline";
import { catalogOptions, type AgentCatalog } from "./catalog";

const executable = process.env.COMPANION_CLI_PATH;
if (!executable) throw new Error("COMPANION_CLI_PATH is required");
const child = spawnCli(executable, ["agent", "stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const catalogs = new Map<string, AgentCatalog>();
const efforts = new Map<string, string>();
const modes = new Map<string, string>();
const availableModes = [
  { id: "default", name: "Agent" },
  { id: "plan", name: "Plan" },
  { id: "yolo", name: "YOLO" },
];
const pending = new Map<
  string | number,
  {
    hostId: string | number;
    method: string;
    sessionId?: string;
    modelId?: string;
    effort?: string;
    modeId?: string;
  }
>();
const plans = new Map<string, string | number>();
let nextId = 0;
const send = (frame: unknown) => process.stdout.write(JSON.stringify(frame) + "\n");
const stop = () => child.kill();
child.stderr.pipe(process.stderr);
child.on("error", (error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
  process.stdin.destroy();
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
  process.stdin.destroy();
});
process.stdin.on("end", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.stdin.on("error", stop);

createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    const frame = JSON.parse(line) as CompanionWireFrame;
    if (frame.method === "session/set_mode") {
      const sessionId = frame.params?.sessionId;
      const modeId = frame.params?.modeId;
      if (
        !sessionId ||
        typeof modeId !== "string" ||
        !availableModes.some((mode) => mode.id === modeId)
      ) {
        send({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32602, message: "Unknown Grok mode" },
        });
        return;
      }
      pending.set(frame.id!, { hostId: frame.id!, method: frame.method, sessionId, modeId });
      frame.params!.modeId = modeId === "yolo" ? "default" : modeId;
      child.stdin.write(JSON.stringify(frame) + "\n");
      return;
    }
    if (!frame.method && plans.has(String(frame.id))) {
      const id = plans.get(String(frame.id));
      plans.delete(String(frame.id));
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: nativePlanResult(frame.result as Parameters<typeof nativePlanResult>[0]),
        }) + "\n"
      );
      return;
    }
    if (frame.method === "session/set_config_option") {
      if (
        frame.id === undefined ||
        !frame.params ||
        typeof frame.params.configId !== "string" ||
        typeof frame.params.value !== "string"
      )
        throw new Error("Malformed Grok config request");
      const { sessionId, configId, value } = frame.params;
      const catalog = catalogs.get(sessionId);
      const option =
        catalog &&
        catalogOptions(catalog, efforts.get(sessionId)).find((entry) => entry.id === configId);
      if (!catalog || !option?.options.some((entry) => entry.value === value)) {
        send({
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32602, message: "Unsupported model or reasoning effort" },
        });
        return;
      }
      const modelId = configId === "model" ? value : catalog.currentModelId;
      const effort = configId === "reasoning_effort" ? value : undefined;
      const id = `copilot:${++nextId}`;
      pending.set(id, { hostId: frame.id, method: frame.method, sessionId, modelId, effort });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "session/set_model",
          params: { sessionId, modelId, ...(effort ? { _meta: { reasoningEffort: effort } } : {}) },
        }) + "\n"
      );
      return;
    }
    if (frame.id !== undefined && frame.method)
      pending.set(frame.id, {
        hostId: frame.id,
        method: frame.method,
        sessionId: frame.params?.sessionId,
      });
    if (frame.method === "session/prompt" && process.env.COMPANION_SYSTEM_PROMPT) {
      const text = frame.params?.prompt?.find((part: { type: string }) => part.type === "text");
      if (text?.type === "text") text.text = prependCopilotInstructions(text.text);
      else frame.params?.prompt?.unshift({ type: "text", text: prependCopilotInstructions("") });
      child.stdin.write(JSON.stringify(frame) + "\n");
    } else child.stdin.write(line + "\n");
  } catch (error) {
    process.stderr.write(String(error) + "\n");
  }
});

createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const frame = JSON.parse(line) as CompanionWireFrame;
    if (frame.method === "session/request_permission" && frame.params) {
      const mode = modes.get(frame.params.sessionId);
      const toolCall = frame.params.toolCall as { kind?: string } | undefined;
      const options = frame.params.options as Array<{ kind: string; optionId: string }> | undefined;
      const allow = options?.find((option) => option.kind === "allow_once");
      if ((mode === "yolo" || mode === "plan") && toolCall?.kind !== "switch_mode" && allow) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            result: { outcome: { outcome: "selected", optionId: allow.optionId } },
          }) + "\n"
        );
        return;
      }
    }
    if (
      ["x.ai/session/update", "_x.ai/session/update", "session/update"].includes(
        frame.method ?? ""
      ) &&
      frame.params?.update?.sessionUpdate === "current_mode_update"
    ) {
      const { sessionId, update } = frame.params;
      const switching = [...pending.values()].find(
        (request) => request.method === "session/set_mode" && request.sessionId === sessionId
      );
      if (switching) return;
      const native = String(update.currentModeId);
      const modeId = native === "default" && modes.get(sessionId) === "yolo" ? "yolo" : native;
      modes.set(sessionId, modeId);
      frame.method = "session/update";
      update.currentModeId = modeId;
    }
    if (["x.ai/exit_plan_mode", "_x.ai/exit_plan_mode"].includes(frame.method ?? "")) {
      const id = `grok-plan:${++nextId}`;
      if (frame.id === undefined || !frame.params) throw new Error("Malformed Grok plan request");
      plans.set(id, frame.id);
      send({
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: planPermission(frame.params, id),
      });
      return;
    }
    const request = frame.method
      ? undefined
      : frame.id === undefined
        ? undefined
        : pending.get(frame.id);
    if (request && (frame.result !== undefined || frame.error)) {
      pending.delete(frame.id!);
      frame.id = request.hostId;
      if (frame.result !== undefined) {
        const sessionId = frame.result.sessionId ?? request.sessionId;
        if (sessionId && request.method === "session/set_mode") {
          modes.set(sessionId, request.modeId!);
          send({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              update: { sessionUpdate: "current_mode_update", currentModeId: request.modeId },
            },
          });
        }
        if (sessionId && ["session/new", "session/load", "session/fork"].includes(request.method)) {
          const currentModeId =
            frame.result.modes?.currentModeId ?? modes.get(sessionId) ?? "default";
          modes.set(sessionId, currentModeId);
          frame.result.modes = { currentModeId, availableModes };
        }
        const models = frame.result.models ?? frame.result._meta?.models;
        if (sessionId && models?.availableModels) {
          const exact = models.availableModels.find(
            (model: { modelId: string }) => model.modelId === models.currentModelId
          );
          if (!exact) {
            const matches = models.availableModels
              .filter((model: { modelId: string }) =>
                models.currentModelId?.startsWith(model.modelId)
              )
              .sort(
                (a: { modelId: string }, b: { modelId: string }) =>
                  b.modelId.length - a.modelId.length
              );
            if (matches[0]) models.currentModelId = matches[0].modelId;
          }
          catalogs.set(sessionId, models);
          const active = models.availableModels.find(
            (model: { modelId: string }) => model.modelId === models.currentModelId
          );
          if (active?._meta?.reasoningEffort) efforts.set(sessionId, active._meta.reasoningEffort);
        }
        if (request.method === "session/set_config_option" && sessionId) {
          const failure =
            frame.result._meta?.model?.Err ||
            (!frame.result._meta?.model?.Ok
              ? "Grok did not confirm the requested model change"
              : null);
          if (failure) {
            frame.error = { code: -32603, message: String(failure) };
            delete frame.result;
          } else {
            const catalog = catalogs.get(sessionId)!;
            catalog.currentModelId = request.modelId;
            if (request.effort) efforts.set(sessionId, request.effort);
            frame.result = { configOptions: catalogOptions(catalog, efforts.get(sessionId)) };
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId,
                update: {
                  sessionUpdate: "config_option_update",
                  configOptions: frame.result.configOptions,
                },
              },
            });
          }
        } else if (sessionId && catalogs.has(sessionId)) {
          frame.result.configOptions = catalogOptions(
            catalogs.get(sessionId)!,
            efforts.get(sessionId)
          );
        }
      }
    }
    if (
      ["x.ai/session/update", "_x.ai/session/update", "session/update"].includes(
        frame.method ?? ""
      ) &&
      frame.params?.update?.sessionUpdate === "model_changed"
    ) {
      const { sessionId, update } = frame.params;
      const catalog = catalogs.get(sessionId);
      if (catalog) {
        const offered = catalog.availableModels
          .filter((model) => update.model_id?.startsWith(model.modelId))
          .sort((a, b) => b.modelId.length - a.modelId.length);
        if (offered[0]) catalog.currentModelId = offered[0].modelId;
        if (typeof update.reasoning_effort === "string")
          efforts.set(sessionId, update.reasoning_effort);
        else efforts.delete(sessionId);
        send({
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "config_option_update",
              configOptions: catalogOptions(catalog, efforts.get(sessionId)),
            },
          },
        });
      }
      return;
    }
    if (
      frame.params?.update?.sessionUpdate === "user_message_chunk" &&
      frame.params.update.content?.type === "text"
    )
      frame.params.update.content.text = stripCopilotInstructions(frame.params.update.content.text);
    send(frame);
  } catch (error) {
    process.stderr.write(String(error) + "\n");
  }
});
