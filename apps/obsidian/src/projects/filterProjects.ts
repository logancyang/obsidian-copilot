import { ProjectConfig } from "@/aiParams";

function searchInProject(project: ProjectConfig, query: string): boolean {
  const processedQuery = query.toLowerCase();

  if (project.name.toLowerCase().includes(processedQuery)) {
    return true;
  }

  return !!project.description && project.description.toLowerCase().includes(processedQuery);
}

export function filterProjects(
  projects: ProjectConfig[] | null | undefined,
  query: string
): ProjectConfig[] {
  if (!projects || projects.length === 0) {
    return [];
  }

  if (!query.trim()) {
    return projects;
  }

  return projects.filter((project) => searchInProject(project, query));
}
