const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;

export function suffixOnCollision(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 1_000_000; i++) {
    const candidate = `${name}-${i}`;
    if (candidate.length > NAME_MAX) {
      throw new Error(`Cannot suffix "${name}" without exceeding the ${NAME_MAX}-char name cap.`);
    }
    if (!NAME_RE.test(candidate)) {
      continue;
    }
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free suffix for "${name}".`);
}
