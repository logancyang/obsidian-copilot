export function errCode(err: unknown): string | null {
  if (err !== null && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}
