/**
 * Defensive runtime parse of the Claude Agent SDK's message-level
 * `tool_use_result` (typed `unknown`) into a structured before/after diff for a
 * File edit/write. The SDK delivers Edit/Write results as `FileEditOutput` /
 * `FileWriteOutput`, but we never trust the static types here: the value is
 * `unknown`, so every field is validated at runtime and any unexpected shape
 * yields `null` rather than a throw. Kept free of SDK-type imports so it stays a
 * pure validator, and free of `@/agentMode/ui/*` imports (the sdk→ui layer
 * boundary forbids it).
 */

export interface SdkEditDiff {
  path: string;
  oldText: string;
  newText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Replace only the first occurrence of `needle`, treating `replacement` as a
 * literal. `String.prototype.replace(string, string)` is unsuitable here: it
 * interprets `$&`, `$$`, `` $` ``, `$'`, `$n` in the replacement as special
 * patterns, so an Edit whose `newString` legitimately contains a `$` would be
 * corrupted in the reconstructed after-text. `split(needle).join(replacement)`
 * is literal but replaces *every* occurrence — wrong for the first-occurrence
 * (`replaceAll: false`) semantics — so we splice by index instead. Callers
 * ensure `needle` is non-empty and present.
 */
function replaceFirstLiteral(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  if (at < 0) return haystack;
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

export function readSdkFileEditResult(toolUseResult: unknown): SdkEditDiff | null {
  if (!isRecord(toolUseResult)) return null;

  // Strong signal this is a File edit/write result (and not a Read/Bash/Grep
  // result): a string `filePath` alongside an array `structuredPatch`.
  const filePath = toolUseResult.filePath;
  if (typeof filePath !== "string") return null;
  if (!Array.isArray(toolUseResult.structuredPatch)) return null;

  // Write result (`FileWriteOutput`): the full new content is `content`.
  const content = toolUseResult.content;
  if (typeof content === "string") {
    const originalFile = toolUseResult.originalFile;
    return {
      path: filePath,
      oldText: typeof originalFile === "string" ? originalFile : "",
      newText: content,
    };
  }

  // Edit result (`FileEditOutput`): reconstruct the after-text from the
  // original plus the (possibly repeated) string replacement.
  const oldString = toolUseResult.oldString;
  const newString = toolUseResult.newString;
  if (typeof oldString === "string" && typeof newString === "string") {
    // `originalFile` is `unknown`; only a string is a real prior body. Anything
    // else (null for a fresh edit target, or an unexpected non-primitive) maps
    // to the empty prior text rather than a bogus `[object Object]`.
    const rawOriginal = toolUseResult.originalFile;
    const originalFile = typeof rawOriginal === "string" ? rawOriginal : "";
    const replaceAll = toolUseResult.replaceAll === true;
    // An empty or absent `oldString` has no well-defined single-occurrence
    // replacement — fall back to a safe no-op rather than throwing.
    const newText =
      oldString.length > 0 && originalFile.includes(oldString)
        ? replaceAll
          ? originalFile.split(oldString).join(newString)
          : replaceFirstLiteral(originalFile, oldString, newString)
        : originalFile;
    return { path: filePath, oldText: originalFile, newText };
  }

  return null;
}
