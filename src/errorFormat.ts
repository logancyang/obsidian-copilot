export function err2String(err: unknown, stack = false): string {
  try {
    if (err instanceof Error) {
      const causeMsg =
        (err as any)?.cause instanceof Error
          ? (err as any).cause.message
          : (err as any)?.cause
            ? String((err as any).cause)
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
