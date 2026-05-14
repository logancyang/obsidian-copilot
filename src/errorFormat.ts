export function err2String(err: unknown, stack = false): string {
  try {
    if (err instanceof Error) {
      const cause = (err as { cause?: unknown }).cause;
      const causeMsg =
        cause instanceof Error
          ? cause.message
          : cause != null
            ? typeof cause === "string"
              ? cause
              : (JSON.stringify(cause) ?? "")
            : "";
      const stackStr = stack && err.stack ? err.stack : "";
      const parts = [err.message];
      if (causeMsg) parts.push(`more message: ${causeMsg}`);
      if (stackStr) parts.push(stackStr);
      return parts.join("\n");
    }
    const json = JSON.stringify(err);
    return json ?? String(err);
  } catch {
    return String(err);
  }
}
