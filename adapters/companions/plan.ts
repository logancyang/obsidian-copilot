export function planPermission(
  params: { sessionId: string; planContent?: string; plan?: string },
  toolCallId: string
) {
  return {
    sessionId: params.sessionId,
    toolCall: {
      toolCallId,
      title: "Review implementation plan",
      kind: "switch_mode",
      status: "pending",
      rawInput: { plan: params.planContent ?? params.plan ?? "" },
    },
    options: [
      { optionId: "approve", kind: "allow_once", name: "Implement plan" },
      { optionId: "reject", kind: "reject_once", name: "Keep planning" },
    ],
  };
}

export function nativePlanResult(
  result: { outcome?: { outcome?: string; optionId?: string } } | undefined
) {
  return {
    outcome:
      result?.outcome?.outcome === "selected" && result.outcome.optionId === "approve"
        ? "approved"
        : "cancelled",
  };
}
