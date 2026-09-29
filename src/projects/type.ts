import { ProjectConfig } from "@/aiParams";

export interface ProjectFileRecord {
  project: ProjectConfig;

  filePath: string;

  folderName: string;
}

export interface ProjectScanDiagnostics {
  duplicateIdIndex: Record<string, string[]>;
  ignoredFiles: string[];
}
