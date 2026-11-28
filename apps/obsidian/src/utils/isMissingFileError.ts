import { errCode } from "@/utils/errorUtils";

export function isMissingFileError(error: unknown): boolean {
  if (errCode(error) === "ENOENT") return true;

  if (error instanceof Error && error.name === "NotFoundError") return true;

  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|no such file|not found|does not exist/i.test(message);
}
