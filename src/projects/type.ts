import { ProjectConfig } from "@/aiParams";

/**
 * A parsed project file record (project.md).
 *
 * - `project.id`: authoritative value from frontmatter; folder name as fallback
 * - `filePath`: vault path for write-back operations (e.g. last-used throttled persist)
 */
export interface ProjectFileRecord {
  /** Runtime-compatible ProjectConfig. */
  project: ProjectConfig;

  /** Vault path of the project.md file. */
  filePath: string;

  /** Parent folder name (used as id fallback). */
  folderName: string;
}

/**
 * Diagnostics from a full project scan (duplicate id detection, ignored files).
 */
export interface ProjectScanDiagnostics {
  duplicateIdIndex: Record<string, string[]>;
  ignoredFiles: string[];
}
