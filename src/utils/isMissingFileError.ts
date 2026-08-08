import { errCode } from "@/utils/errorUtils";

/**
 * True when an error thrown by a vault adapter read means the file is absent,
 * as opposed to a genuine read failure. Obsidian surfaces this differently per
 * platform: Node's desktop `FileSystemAdapter` throws an `ENOENT` Error, while
 * other adapters use a `NotFoundError` name or "not found" / "does not exist"
 * messages — so match the common shapes rather than a single string.
 */
export function isMissingFileError(error: unknown): boolean {
  if (errCode(error) === "ENOENT") return true;

  if (error instanceof Error && error.name === "NotFoundError") return true;

  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|no such file|not found|does not exist/i.test(message);
}
