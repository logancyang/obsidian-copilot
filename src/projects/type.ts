import { ProjectConfig } from "@/aiParams";

export interface ProjectFileRecord {
  project: ProjectConfig;

  filePath: string;

  folderName: string;
}
