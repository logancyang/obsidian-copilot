import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";

/**
 * The context-source fields whose change should invalidate a project's
 * materialized context. Deliberately excludes `systemPrompt`, `modelConfigs`,
 * `UsageTimestamps`, etc. — those affect a session's behavior but not which
 * external sources get materialized into the off-vault conversion cache.
 */
interface NormalizedContextSource {
  inclusions: string;
  exclusions: string;
  webUrls: string;
  youtubeUrls: string;
}

/**
 * Collapse a multiline config value to a canonical form so cosmetic edits
 * (trailing spaces, blank lines, reordering-free whitespace) don't read as a
 * real change. Returns lines trimmed, blanks dropped, rejoined with `\n`.
 *
 * DESIGN NOTE: this is a deliberately CHEAP textual normalization, not a
 * resolved-glob comparison. A reviewer may suggest deriving the signature from
 * `getMatchingPatterns()` so two patterns that match the same files read as
 * equal — don't. That would resolve globs against the live vault on every
 * project-records publish (a hot path), and the worst case of an over-eager
 * signature is benign: one extra materialization that single-flights and
 * cheap-skips unchanged sources — the same cost as the feature's happy path.
 */
function normalizeMultiline(value: string | undefined): string {
  if (!value) return "";
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Canonical view of the fields that drive context materialization. Used to
 * decide whether a project edit actually changed its external sources (vs. a
 * usage-timestamp touch or an unrelated config tweak).
 */
export function normalizeProjectContextSource(project: ProjectConfig): NormalizedContextSource {
  const source = project.contextSource;
  return {
    inclusions: normalizeMultiline(source?.inclusions),
    exclusions: normalizeMultiline(source?.exclusions),
    webUrls: normalizeMultiline(source?.webUrls),
    youtubeUrls: normalizeMultiline(source?.youtubeUrls),
  };
}

/**
 * A stable fingerprint of everything that determines a project's materialized
 * context: its normalized source fields PLUS its `filePath` (the project folder
 * — and therefore the resolved cwd and the manifest's absolute paths — moves
 * when the file is renamed/relocated even if the config is byte-identical). Two
 * records with the same signature need no re-materialization.
 */
export function getProjectContextSignature(record: ProjectFileRecord): string {
  return JSON.stringify({
    source: normalizeProjectContextSource(record.project),
    filePath: record.filePath,
  });
}

/**
 * Fingerprint of a project's materialized context plus its legacy project.md
 * instruction body. The body remains here for compatibility with projects that
 * have not yet initialized AGENTS.md.
 *
 * Kept SEPARATE from {@link getProjectContextSignature} on purpose: that one
 * drives re-materialization (glob/URL/PDF conversion) and must stay insensitive
 * to `systemPrompt` (see its DESIGN NOTE) — folding the legacy body in there
 * would re-materialize context unnecessarily. It is compared verbatim because
 * `project.md` preserves its whitespace.
 */
export function getProjectLandingCaptureSignature(record: ProjectFileRecord): string {
  return JSON.stringify({
    context: getProjectContextSignature(record),
    systemPrompt: record.project.systemPrompt ?? "",
  });
}

/**
 * Compose a content-aware dirty key from a config signature and a content
 * revision epoch. The config signature (see {@link getProjectContextSignature})
 * only moves when the project's declared sources change; edits to the FILES
 * those sources point at do not touch it. Salting it with the tracker's
 * per-project epoch lets a pure content change still read as a distinct dirty
 * revision, so it can gate empty-landing reuse and drive re-materialization
 * through the same machinery a config edit uses.
 */
export function composeContextDirtyKey(configSignature: string, epoch: number): string {
  return `${configSignature}#${epoch}`;
}

/**
 * Whether a dirty key (possibly epoch-salted by {@link composeContextDirtyKey})
 * belongs to the given config signature. True when the key is the bare config
 * signature, or the config signature followed by `#<digits>`. The dirty-clear
 * guard uses this to confirm a materialization result (which carries only the
 * config signature) corresponds to the captured dirty key's config — the exact
 * epoch is enforced separately by comparing the whole captured key.
 */
export function contextDirtyKeyMatchesConfig(
  key: string | undefined,
  configSignature: string
): boolean {
  if (key === undefined) return false;
  if (key === configSignature) return true;
  // Reason: the salt is appended as `#<epoch>`; split on the LAST `#` so a `#`
  // inside the JSON signature itself can't cause a false prefix match.
  const lastHash = key.lastIndexOf("#");
  if (lastHash < 0) return false;
  return key.slice(0, lastHash) === configSignature && /^\d+$/.test(key.slice(lastHash + 1));
}
