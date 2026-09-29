import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { tryReadExitPlanModeCall, type AgentSession } from "@/agentMode/session/AgentSession";
import type { MockBackend } from "@/agentMode/session/host/hostTestHarness";
import type { ScriptStep, SessionScript } from "@/agentMode/session/host/sessionScript";
import type { BackendState, PermissionPrompt, StopReason } from "@/agentMode/session/types";

export const SYNTHETIC_BACKEND_STATE: BackendState = {
  model: {
    current: { baseModelId: "model-a", effort: null },
    availableModels: [
      { baseModelId: "model-a", name: "Model A", provider: null, effortOptions: [] },
    ],
    apply: { kind: "setModel" },
  },
  mode: {
    current: "default",
    options: [
      { value: "default", label: "Default" },
      { value: "plan", label: "Plan" },
    ],
    apply: {
      default: { kind: "setMode", nativeId: "default" },
      plan: { kind: "setMode", nativeId: "plan" },
    },
  },
};

export interface ScriptRig {
  session: AgentSession;
  backend: MockBackend;
  client: SessionClient;
  sessionId: string;
  backendSessionId: string;
  settle: () => Promise<void>;
  beforeAnswer?: () => void | Promise<void>;
  afterStep?: (step: ScriptStep, index: number) => void | Promise<void>;
}

export async function playScript(script: SessionScript, rig: ScriptRig): Promise<void> {
  const present = (request: PermissionPrompt) =>
    tryReadExitPlanModeCall({
      kind: request.toolCall.kind,
      rawInput: request.toolCall.rawInput,
      isPlanProposal: request.toolCall.isPlanProposal,
    })
      ? rig.session.handlePlanProposalPermission(request)
      : rig.session.handleToolPermission(request);
  const inFlight: Promise<unknown>[] = [];
  let release: (stopReason?: StopReason) => void = () => {};

  rig.backend.emit({
    sessionId: rig.backendSessionId,
    update: { sessionUpdate: "state_changed", state: SYNTHETIC_BACKEND_STATE },
  });

  for (const [index, step] of script.steps.entries()) {
    switch (step.step) {
      case "send": {
        release = rig.backend.holdPrompt();
        const result = await rig.client.command({
          name: "send",
          sessionId: rig.sessionId,
          text: step.text,
        });
        if (!result.ok) throw new Error(`send failed: ${result.code}`);
        break;
      }
      case "event":
        rig.backend.emit({ sessionId: rig.backendSessionId, update: step.update });
        break;
      case "permission": {
        const request: PermissionPrompt = { ...step.request, sessionId: rig.backendSessionId };
        inFlight.push(present(request));
        await rig.settle();
        await rig.beforeAnswer?.();
        const plan = rig.session.getCurrentPlan();
        const option = request.options.find((o) => o.optionId === step.optionId);
        const result =
          rig.session.hasPendingPlanPermission() && plan
            ? await rig.client.command({
                name: "resolvePlan",
                sessionId: rig.sessionId,
                proposalId: plan.id,
                decision: option?.kind.startsWith("allow") ? "approve" : "reject",
              })
            : await rig.client.command({
                name: "resolvePermission",
                sessionId: rig.sessionId,
                toolCallId: request.toolCall.toolCallId,
                optionId: step.optionId,
              });
        if (!result.ok) throw new Error(`permission answer failed: ${result.code}`);
        break;
      }
      case "question": {
        inFlight.push(
          rig.session.handleAskUserQuestion({
            sessionId: rig.backendSessionId,
            requestId: step.requestId,
            questions: step.questions,
          })
        );
        await rig.settle();
        await rig.beforeAnswer?.();
        const result = await rig.client.command({
          name: "answerQuestion",
          sessionId: rig.sessionId,
          requestId: step.requestId,
          answers: step.answers,
        });
        if (!result.ok) throw new Error(`answer failed: ${result.code}`);
        break;
      }
      case "cancel":
        await rig.client.command({ name: "cancel", sessionId: rig.sessionId });
        break;
      case "end":
        release(step.stopReason);
        break;
    }
    await rig.settle();
    await rig.afterStep?.(step, index);
  }
  await Promise.all(inFlight);
  await rig.settle();
}
