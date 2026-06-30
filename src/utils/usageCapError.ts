/**
 * Detects a Copilot Plus usage-cap error and formats a user-facing message that
 * points to the website usage dashboard and invites purchasing credits.
 *
 * The models relay returns a 429 whose body is
 *   { detail: { error: { type: "token_limit_error", dashboard_url, credits_hint, message, ... } } }
 * but the error object the plugin catches varies by transport (LangChain wraps the
 * body under different keys), so the detector deep-searches the thrown value for the
 * cap signal rather than assuming one shape.
 */
import { USAGE_DASHBOARD_URL } from "@/constants";

/** The cap fields we look for, wherever they end up nested on the error. */
interface CapErrorFields {
  type?: string;
  dashboard_url?: string;
  credits_hint?: string;
  message?: string;
}

const CAP_TYPE = "token_limit_error";
const MAX_SEARCH_DEPTH = 6;

/**
 * Walk the error value (bounded depth, cycle-safe) and return the first object that
 * carries a usage-cap signal: `type === "token_limit_error"`, or a `dashboard_url` /
 * `credits_hint` field. Returns null when no cap signal is present.
 */
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

/**
 * If `error` is a usage-cap error, return a Markdown message inviting the user to
 * purchase credits on the usage dashboard (a clickable link). Otherwise null, so
 * callers fall through to their generic error handling.
 */
export function formatUsageCapError(error: unknown): string | null {
  const fields = findCapFields(error);
  if (!fields) return null;
  const url = fields.dashboard_url || USAGE_DASHBOARD_URL;
  // Plain text with a bare URL (no Markdown). The main streaming error path renders
  // this via ErrorBlock as plain text (whitespace-pre-wrap), so Markdown link syntax
  // would show literally; a bare URL stays readable there and still auto-links in any
  // Markdown-rendered context.
  return (
    `You've reached your usage cap. To keep going beyond your plan's limit, ` +
    `purchase credits on your usage dashboard: ${url}`
  );
}
