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
