import type { ProjectConfig } from "@/aiParams";
import { AGENTS_FILE_NAME, findCachedInstructionFile } from "@/instructions/agentsFile";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import type { ProjectFileRecord } from "@/projects/type";
import { App, normalizePath } from "obsidian";

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
 * Fingerprint of everything an EMPTY project landing session bakes in at creation: the
 * materialization signature PLUS the project's instructions. A landing session captures its
 * instructions once at start — every backend reads `AGENTS.md` from the session cwd — so an
 * instruction-only edit must replace the still-empty session for the first message to use the
 * new text, even though it changes no materialized source.
 *
 * The instruction term is the `AGENTS.md` mtime/size, NOT the `project.md` body: since
 * AGENTS.md became canonical, the body is inert for Agent Mode, so keying on it would both
 * miss real edits (stale instructions on the first message) and churn on edits that no longer
 * matter. `stat` comes from the vault cache, keeping this synchronous for its render-path
 * callers. Falls back to the legacy body for a project whose AGENTS.md does not exist yet (or
 * lives in a hidden folder Obsidian does not index) — there, the body is still what
 * initializes the file.
 *
 * Kept SEPARATE from {@link getProjectContextSignature} on purpose: that one drives
 * re-materialization (glob/URL/PDF conversion) and must stay insensitive to instructions (see
 * its DESIGN NOTE) — folding them in there would re-materialize on every prompt edit.
 */
/** Instructions fingerprint for a scope whose instruction file Obsidian does not index. */
const UNVERIFIABLE_INSTRUCTIONS = "agents:unverifiable";

/**
 * Whether a landing-capture signature actually pins the scope's instructions.
 *
 * False when the instruction file lives outside the vault cache, where edits to it cannot be
 * observed. A caller reusing an empty landing session on an unverifiable signature would hand
 * the user a backend that read the file before their last edit, so treat it as "spawn fresh".
 *
 * @param signature - A value from {@link getProjectLandingCaptureSignature}, or null off-project
 */
export function landingCaptureIsVerifiable(signature: string | null): boolean {
  return signature !== null && !signature.includes(UNVERIFIABLE_INSTRUCTIONS);
}

export function getProjectLandingCaptureSignature(app: App, record: ProjectFileRecord): string {
  return JSON.stringify({
    context: getProjectContextSignature(record),
    instructions: getInstructionsFingerprint(app, record),
  });
}

function getInstructionsFingerprint(app: App, record: ProjectFileRecord): string {
  // Anchored on the record's own path, matching `resolveScopeCwd`: the file the agent reads
  // is under `dirname(record.filePath)`, which is not the live projects root for the moment
  // after a Copilot-folder change.
  const projectFolderPath = getProjectAnchorFromConfigPath(record.filePath).projectFolderPath;
  const agentsPath = normalizePath(`${projectFolderPath}/${AGENTS_FILE_NAME}`);
  // Resolved the same way the instruction editors resolve it, so a vault holding `agents.md`
  // fingerprints the file they actually write. An exact-case lookup would miss it and fall
  // through to the legacy body — empty once the move ran — giving a fingerprint that never
  // moves no matter how the user edits their instructions.
  const file = findCachedInstructionFile(app, agentsPath);
  if (file) return `agents:${file.stat.mtime}:${file.stat.size}`;
  // A project under a hidden Copilot root (`.copilot`, deliberately supported — see the
  // DESIGN NOTE in `validateCopilotFolder`) is never indexed, so an edit to its real
  // AGENTS.md is invisible from here and the legacy body is empty once the move ran. Say so
  // rather than report a fingerprint that can never change: `landingCaptureIsVerifiable`
  // turns this into "spawn fresh" at the reuse gate. Tested on the path rather than the
  // cache, which is also empty for a folder Obsidian simply has not indexed yet.
  if (agentsPath.split("/").some((segment) => segment.startsWith("."))) {
    return UNVERIFIABLE_INSTRUCTIONS;
  }
  // Compared verbatim (no `normalizeMultiline`): `project.md` preserves the body's
  // whitespace, so a whitespace-only edit is a real change to what the file would be
  // initialized with.
  return `legacy:${record.project.systemPrompt ?? ""}`;
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
