import { ProjectConfig } from "@/aiParams";

/**
 * Project search options configuration
 */
export interface ProjectSearchOptions {
  /** Whether to perform case-sensitive search, defaults to false */
  caseSensitive?: boolean;
  /** Whether to search in project names, defaults to true */
  searchInName?: boolean;
  /** Whether to search in project descriptions, defaults to true */
  searchInDescription?: boolean;
}

/**
 * Check if a single project matches the search query
 * @param project The project to check
 * @param query The search query string
 * @param options Search options
 * @returns Whether the project matches the search criteria
 */
function searchInProject(
  project: ProjectConfig,
  query: string,
  options: ProjectSearchOptions = {}
): boolean {
  const { caseSensitive = false, searchInName = true, searchInDescription = true } = options;

  // If query is empty, match all projects
  if (!query.trim()) {
    return true;
  }

  // Process query string based on case sensitivity setting
  const processedQuery = caseSensitive ? query : query.toLowerCase();

  // Check project name
  if (searchInName) {
    const projectName = caseSensitive ? project.name : project.name.toLowerCase();
    if (projectName.includes(processedQuery)) {
      return true;
    }
  }

  // Check project description
  if (searchInDescription && project.description) {
    const projectDesc = caseSensitive ? project.description : project.description.toLowerCase();
    if (projectDesc.includes(processedQuery)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter project list based on search query
 * @param projects List of projects
 * @param query Search query string
 * @param options Search options
 * @returns Filtered list of projects
 */
export function filterProjects(
  projects: ProjectConfig[],
  query: string,
  options: ProjectSearchOptions = {}
): ProjectConfig[] {
  // If project list is empty, return empty array directly
  if (!projects || projects.length === 0) {
    return [];
  }

  // If query is empty, return all projects
  if (!query.trim()) {
    return projects;
  }

  // Filter projects
  return projects.filter((project) => searchInProject(project, query, options));
}
