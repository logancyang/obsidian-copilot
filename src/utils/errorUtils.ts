/**
 * Best-effort extraction of an FS-style error code (e.g. `ENOENT`, `EACCES`)
 * from an unknown thrown value. Returns `null` when the value isn't an
 * object-with-string-code.
 */
export function errCode(err: unknown): string | null {
  if (err !== null && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}
