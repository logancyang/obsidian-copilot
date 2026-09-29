import { ProjectConfig } from "@/aiParams";

export interface ProjectSearchOptions {
  caseSensitive?: boolean;
  searchInName?: boolean;
  searchInDescription?: boolean;
}

function searchInProject(
  project: ProjectConfig,
  query: string,
  options: ProjectSearchOptions = {}
): boolean {
  const { caseSensitive = false, searchInName = true, searchInDescription = true } = options;

  if (!query.trim()) {
    return true;
  }

  const processedQuery = caseSensitive ? query : query.toLowerCase();

  if (searchInName) {
    const projectName = caseSensitive ? project.name : project.name.toLowerCase();
    if (projectName.includes(processedQuery)) {
      return true;
    }
  }

  if (searchInDescription && project.description) {
    const projectDesc = caseSensitive ? project.description : project.description.toLowerCase();
    if (projectDesc.includes(processedQuery)) {
      return true;
    }
  }

  return false;
}

export function filterProjects(
  projects: ProjectConfig[] | null | undefined,
  query: string,
  options: ProjectSearchOptions = {}
): ProjectConfig[] {
  if (!projects || projects.length === 0) {
    return [];
  }

  if (!query.trim()) {
    return projects;
  }

  return projects.filter((project) => searchInProject(project, query, options));
}
