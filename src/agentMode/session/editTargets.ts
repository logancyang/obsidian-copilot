import { isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";

export interface EditTargetSource {
  locations?: ReadonlyArray<{ path?: string | null }> | null;
  input?: unknown;
  diffPaths?: readonly string[];
}

export function diffTargetPaths(
  outputs: ReadonlyArray<{ type: string; path?: string | null }> | null | undefined
): string[] {
  const paths = new Set<string>();
  for (const output of outputs ?? []) {
    if (output.type === "diff" && typeof output.path === "string" && output.path.length > 0) {
      paths.add(output.path);
    }
  }
  return [...paths];
}

export function primaryEditTargetPath(
  source: EditTargetSource,
  vaultBase: string | null
): string | null {
  const loc = source.locations?.[0]?.path;
  if (typeof loc === "string" && loc.length > 0) return toVaultRelative(loc, vaultBase);
  const input = source.input as
    | { file_path?: unknown; filePath?: unknown; path?: unknown }
    | null
    | undefined;
  if (typeof input?.file_path === "string") return toVaultRelative(input.file_path, vaultBase);
  if (typeof input?.filePath === "string") return toVaultRelative(input.filePath, vaultBase);
  if (typeof input?.path === "string") return toVaultRelative(input.path, vaultBase);
  const diffPaths = source.diffPaths ?? [];
  if (diffPaths.length === 1) return toVaultRelative(diffPaths[0], vaultBase);
  return null;
}

export function editTargetPaths(source: EditTargetSource, vaultBase: string | null): string[] {
  const paths = new Set<string>();
  for (const loc of source.locations ?? []) {
    if (typeof loc?.path === "string" && loc.path.length > 0) {
      paths.add(toVaultRelative(loc.path, vaultBase));
    }
  }
  const primary = primaryEditTargetPath({ input: source.input }, vaultBase);
  if (primary) paths.add(primary);
  for (const diffPath of source.diffPaths ?? []) {
    paths.add(toVaultRelative(diffPath, vaultBase));
  }
  return [...paths];
}

export function isCapturableVaultPath(path: string): boolean {
  if (path.length === 0 || isAbsolutePath(path)) return false;
  return !path.split("/").some((segment) => segment.startsWith("."));
}
