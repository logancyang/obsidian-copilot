import { logError } from "@/logger";
import { AGENTS_MIRROR_FILE } from "@/projects/constants";
import { getProjectFolderPath } from "@/projects/projectPaths";
import { getComposedProjectInstructions } from "@/projects/projectSystemPrompt";
import { addPendingFileWrite, removePendingFileWrite } from "@/projects/state";
import { ProjectFileRecord } from "@/projects/type";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { App, normalizePath, TFile, TFolder } from "obsidian";

// Reason: a project's instruction body is the built-in project policy layered ahead of the
// user's own `project.md` body (see {@link getComposedProjectInstructions}). codex/opencode
// only auto-discover instructions from a physical file in the session cwd, so the plugin
// generates `AGENTS.md` as a ONE-WAY mirror of that composed body. The mirror is derived
// output: it is never read back, never a config source, and only ever touched when it carries
// the marker below — a user's own AGENTS.md (no marker) is left strictly alone.

/**
 * Stable, machine-readable prefix that marks a generated mirror as plugin-owned. Ownership keys
 * off THIS prefix alone, so the rest of {@link MARKER_LINE} (version + the human-facing hint)
 * can evolve without orphaning files already on disk — a later marker reword still recognizes,
 * and rewrites, an earlier one. Exported so tests can build sample markers without re-hardcoding
 * the full line.
 */
export const MIRROR_MARKER_PREFIX = "<!-- copilot:generated-agents-mirror";

/**
 * First (and only) marker line stamped on a generated mirror. Keep it on a SINGLE physical line
 * closing with ` -->`: the envelope is `${MARKER_LINE}\n\n${body}`, and {@link stripMarkerEnvelope}
 * relies on that shape to recover the body byte-for-byte. The prose past the prefix is purely
 * human-facing — it points the user at the real edit surface (the project in Copilot / its
 * `project.md`), since hand-editing this mirror is overwritten on the next session.
 */
const MARKER_LINE =
  `${MIRROR_MARKER_PREFIX} v1 — Auto-generated; do not edit here. To change these instructions, ` +
  "edit this project in Copilot (its project.md); regenerated each session. " +
  "Delete this line to take over the file. -->";

const BOM = "\uFEFF";

/**
 * Per-path operation queue. Serializes ensure/remove calls for the same mirror path so an
 * overlapping create + update (or two session starts) can't race into a double-create; each
 * op re-reads disk state when it runs, so the later op still applies its newer body.
 */
const mirrorOperationQueues = new Map<string, Promise<void>>();

interface MirrorSnapshot {
  exists: boolean;
  /** The cached TFile when the mirror is indexed by the vault (vs. a hidden-folder file). */
  file?: TFile;
  /**
   * The mirrored body when the file carries the generated marker, else `null`. A `null`
   * payload means "not ours" — either the file is absent or it is a user-authored AGENTS.md
   * we must never overwrite or delete.
   */
  managedPayload: string | null;
}

/**
 * Generate or refresh the project's `AGENTS.md` mirror from its composed instruction body
 * (built-in project policy + the user's `project.md` body — see
 * {@link getComposedProjectInstructions}).
 *
 * Guarantees (never throws — failures are logged so they can't block session start):
 * - Marker gating: only a marker'd mirror is ever overwritten; a user's AGENTS.md is untouched.
 * - Cheap-skip: compares the BODY payload only, so a context/url/last-used change to the
 *   project (which leaves the instruction body unchanged) does not churn the mirror.
 * - The composed body is always non-empty (the built-in policy is always present), so the
 *   empty-body delete path below is effectively unreachable for a real project; it is kept as a
 *   defensive guard and still never touches a user's own (unmarked) file.
 */
export async function ensureAgentsMirror(app: App, record: ProjectFileRecord): Promise<void> {
  try {
    const mirrorPath = getMirrorPath(record);
    await runQueued(mirrorPath, () =>
      ensureMirrorInternal(app, mirrorPath, getComposedProjectInstructions(record))
    );
  } catch (error) {
    logError(
      `[Projects] Failed to ensure AGENTS.md mirror for project "${record.project.id}"`,
      error
    );
  }
}

/**
 * Delete the generated `AGENTS.md` mirror for a project being removed — but only when it
 * carries the generated marker. A user-authored AGENTS.md is left in place.
 */
export async function removeAgentsMirror(app: App, record: ProjectFileRecord): Promise<void> {
  try {
    const mirrorPath = getMirrorPath(record);
    await runQueued(mirrorPath, () => removeMirrorInternal(app, mirrorPath));
  } catch (error) {
    logError(
      `[Projects] Failed to remove AGENTS.md mirror for project "${record.project.id}"`,
      error
    );
  }
}

async function ensureMirrorInternal(app: App, mirrorPath: string, body: string): Promise<void> {
  // Empty instruction → no mirror at all; drop a stale generated one (never a user file).
  if (body.length === 0) {
    await removeMirrorInternal(app, mirrorPath);
    return;
  }

  const snapshot = await readMirror(app, mirrorPath);

  // User-authored AGENTS.md (no marker) → escape hatch, never touch it.
  if (snapshot.exists && snapshot.managedPayload === null) return;

  // Body unchanged → skip (compares the body payload only, not the whole config).
  if (snapshot.managedPayload === body) return;

  addPendingFileWrite(mirrorPath);
  try {
    // Re-read inside the guard to absorb a file that appeared during the first read.
    const latest = await readMirror(app, mirrorPath);
    if (latest.exists && latest.managedPayload === null) return;
    if (latest.managedPayload === body) return;
    await writeMirror(app, latest, mirrorPath, buildMirrorContent(body));
  } finally {
    removePendingFileWrite(mirrorPath);
  }
}

async function removeMirrorInternal(app: App, mirrorPath: string): Promise<void> {
  const snapshot = await readMirror(app, mirrorPath);
  if (!snapshot.exists || snapshot.managedPayload === null) return;

  addPendingFileWrite(mirrorPath);
  try {
    const latest = await readMirror(app, mirrorPath);
    if (!latest.exists || latest.managedPayload === null) return;
    if (latest.file) {
      await trashFile(app, latest.file);
    } else {
      await app.vault.adapter.remove(mirrorPath);
    }
  } finally {
    removePendingFileWrite(mirrorPath);
  }
}

function getMirrorPath(record: ProjectFileRecord): string {
  return normalizePath(`${getProjectFolderPath(record.folderName)}/${AGENTS_MIRROR_FILE}`);
}

function buildMirrorContent(body: string): string {
  return `${MARKER_LINE}\n\n${body}`;
}

/**
 * Recover the mirrored body from on-disk content, or `null` when the file is not a generated
 * mirror. Ownership is recognized by the stable {@link MIRROR_MARKER_PREFIX} rather than the full
 * line, so an older marker wording is still recovered (and rewritten) — but the first line must
 * be a well-formed single-line HTML comment (prefix, then a space boundary, closing with ` -->`)
 * followed by exactly one blank line, else we treat it as a user file and don't manage it. The
 * body is sliced past that envelope so it round-trips byte-for-byte, even when it starts with
 * newlines.
 */
function stripMarkerEnvelope(content: string): string | null {
  const offset = content.startsWith(BOM) ? BOM.length : 0;
  if (!content.startsWith(MIRROR_MARKER_PREFIX, offset)) return null;
  // Require a space after the prefix so a user line like `…generated-agents-mirrorish` is not
  // mistaken for ours.
  if (content[offset + MIRROR_MARKER_PREFIX.length] !== " ") return null;

  const lf = content.indexOf("\n", offset);
  if (lf === -1) return null;

  // The marker must occupy the whole first line and close the HTML comment. Trim a CRLF `\r`
  // before testing so both line endings are accepted.
  const isCrlf = lf > offset && content[lf - 1] === "\r";
  const lineEnd = isCrlf ? lf - 1 : lf;
  if (!content.slice(offset, lineEnd).endsWith(" -->")) return null;

  // The marker line is followed by exactly one blank line, in the SAME newline style; the body
  // starts after it. Anything else (`marker\nbody`, or a mixed `\r\n`/`\n` separator) is a
  // malformed/hand-edited envelope → treat as a user file we don't manage.
  const afterLineBreak = lf + 1;
  const blankLine = isCrlf ? "\r\n" : "\n";
  if (content.startsWith(blankLine, afterLineBreak)) {
    return content.slice(afterLineBreak + blankLine.length);
  }
  return null;
}

/**
 * Whether `content` is a plugin-generated `AGENTS.md` mirror (carries the marker
 * envelope) rather than a user-authored file. The marker is the project's sole
 * ownership signal — basename/path can't distinguish the two, since a generated
 * mirror and a user's own `AGENTS.md` occupy the same path. Callers that only
 * need the yes/no (e.g. deciding whether to surface the file in a listing) use
 * this instead of reaching for the marker constant.
 */
export function isGeneratedAgentsMirrorContent(content: string): boolean {
  return stripMarkerEnvelope(content) !== null;
}

async function readMirror(app: App, mirrorPath: string): Promise<MirrorSnapshot> {
  const abstractFile = app.vault.getAbstractFileByPath(mirrorPath);
  if (abstractFile) {
    if (!(abstractFile instanceof TFile)) {
      // A folder occupies the path — not ours; never touch.
      return { exists: true, managedPayload: null };
    }
    const content = await app.vault.read(abstractFile);
    return { exists: true, file: abstractFile, managedPayload: stripMarkerEnvelope(content) };
  }

  if (!(await app.vault.adapter.exists(mirrorPath))) {
    return { exists: false, managedPayload: null };
  }
  const content = await app.vault.adapter.read(mirrorPath);
  return { exists: true, managedPayload: stripMarkerEnvelope(content) };
}

async function writeMirror(
  app: App,
  snapshot: MirrorSnapshot,
  mirrorPath: string,
  content: string
): Promise<void> {
  if (snapshot.file) {
    await app.vault.modify(snapshot.file, content);
    return;
  }

  // No cached TFile: create through the vault when the parent folder is indexed (keeps the
  // vault cache consistent), else fall back to the adapter for hidden-folder projects.
  const folderPath = normalizePath(mirrorPath.split("/").slice(0, -1).join("/"));
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (folder instanceof TFolder && !snapshot.exists) {
    await app.vault.create(mirrorPath, content);
    return;
  }
  await app.vault.adapter.write(mirrorPath, content);
}

async function runQueued(mirrorPath: string, operation: () => Promise<void>): Promise<void> {
  const previous = mirrorOperationQueues.get(mirrorPath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  mirrorOperationQueues.set(mirrorPath, next);
  try {
    await next;
  } finally {
    // Reason: only clear when still the tail, so a later-enqueued op isn't orphaned.
    if (mirrorOperationQueues.get(mirrorPath) === next) {
      mirrorOperationQueues.delete(mirrorPath);
    }
  }
}
