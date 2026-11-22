import { USAGE_DASHBOARD_URL } from "@/constants";

interface CapErrorFields {
  type?: string;
  dashboard_url?: string;
  credits_hint?: string;
  message?: string;
}

const CAP_TYPE = "token_limit_error";
const MAX_SEARCH_DEPTH = 6;

function findCapFields(
  value: unknown,
  depth = 0,
  seen = new Set<unknown>()
): CapErrorFields | null {
  if (!value || typeof value !== "object" || depth > MAX_SEARCH_DEPTH || seen.has(value)) {
    return null;
  }
  seen.add(value);

  const obj = value as Record<string, unknown>;
  const isCap =
    obj.type === CAP_TYPE ||
    typeof obj.dashboard_url === "string" ||
    typeof obj.credits_hint === "string";
  if (isCap) {
    return {
      type: typeof obj.type === "string" ? obj.type : undefined,
      dashboard_url: typeof obj.dashboard_url === "string" ? obj.dashboard_url : undefined,
      credits_hint: typeof obj.credits_hint === "string" ? obj.credits_hint : undefined,
      message: typeof obj.message === "string" ? obj.message : undefined,
    };
  }

  for (const child of Object.values(obj)) {
    const found = findCapFields(child, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

export function formatUsageCapError(error: unknown): string | null {
  const fields = findCapFields(error);
  if (!fields) return null;
  const url = fields.dashboard_url || USAGE_DASHBOARD_URL;
  return (
    `You've reached your usage cap. To keep going beyond your plan's limit, ` +
    `purchase credits on your usage dashboard: ${url}`
  );
}
