export function parseToolInput(args: unknown): Record<string, unknown> | undefined {
  if (typeof args !== "string") return;
  try {
    const value: unknown = JSON.parse(args);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}
