/**
 * Spec rule: lowercase a–z / 0–9 / hyphens; no leading/trailing/consecutive
 * hyphens; 1–64 chars. Mirrors the validator in `skillFormat.ts` so a
 * suffixed name is guaranteed to satisfy `validateName`.
 */
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;

/**
 * Compute the smallest spec-valid name not present in `taken`. Returns
 * `name` if free; otherwise `name-2`, `name-3`, … until a free one is
 * found. The original name is appended-to verbatim — we do NOT try to
 * detect existing `-N` suffixes and increment them (e.g. `foo-2` colliding
 * becomes `foo-2-2`, not `foo-3`). That keeps the rule mechanical and
 * predictable; the spec doesn't distinguish.
 *
 * Throws if no spec-valid suffix fits within the 64-char cap, which only
 * happens for pathologically long source names.
 */
export function suffixOnCollision(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 1_000_000; i++) {
    const candidate = `${name}-${i}`;
    if (candidate.length > NAME_MAX) {
      throw new Error(`Cannot suffix "${name}" without exceeding the ${NAME_MAX}-char name cap.`);
    }
    if (!NAME_RE.test(candidate)) {
      // Defensive: should be unreachable for any spec-valid `name`, but
      // guard anyway in case a malformed `name` slipped through.
      continue;
    }
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free suffix for "${name}".`);
}
