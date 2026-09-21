/** Matches a complete version string; captures major, minor, patch, and prerelease. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
}

/**
 * Parses a complete version string for package metadata validation.
 * Returns null for invalid input; leading `v` and surrounding text are not accepted.
 * @param version - Package version, optionally including prerelease and build metadata.
 */
export function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_PATTERN.exec(version);
  // Invalid package metadata must not make a runtime appear ready.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/535
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

/**
 * Compare two dotted version strings by numeric major/minor/patch, ignoring any
 * leading `v` and any prerelease/build suffix (`v1.15.13-beta` compares as
 * `1.15.13`). Returns a negative number when `a < b`, `0` when equal, and a
 * positive number when `a > b`. A version with no parseable `x.y.z` sorts as
 * the lowest, so callers treat a malformed/unknown version as "behind".
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
