import CopilotPlugin from "@/main";
import {
  Project,
  ProjectStatus,
  ProjectExtraction,
  UpdateProjectInput,
} from "@/types/projects-plus";
import { Plus, Search } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectList from "./ProjectList";
import ProjectDialog from "./ProjectDialog";
import ProjectCreation from "./ProjectCreation";

interface ProjectsPanelProps {
  plugin: CopilotPlugin;
}

type FilterStatus = ProjectStatus | "all";
type ViewType = "list" | "create";

/**
 * ProjectsPanel - Main container for the Projects+ interface
 *
 * Displays project list with search/filter capabilities and
 * provides project creation functionality via AI-assisted flow.
 */
export default function ProjectsPanel({ plugin }: ProjectsPanelProps) {
  const [view, setView] = useState<ViewType>("list");
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  // Subscribe to ProjectManager changes
  useEffect(() => {
    const unsubscribe = plugin.projectsPlusManager.subscribe(() => {
      setProjects(plugin.projectsPlusManager.getAllProjects());
    });

    // Initial load
    setProjects(plugin.projectsPlusManager.getAllProjects());

    return unsubscribe;
  }, [plugin.projectsPlusManager]);

  // Filter and search logic
  const filteredProjects = useMemo(() => {
    let result = projects;

    // Filter by status
    if (filter !== "all") {
      result = result.filter((p) => p.status === filter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
      );
    }

    // Sort by most recently updated
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects, filter, searchQuery]);

  /**
   * Handle project creation completion from AI-assisted flow
   */
  const handleProjectCreationComplete = useCallback(
    async (extraction: ProjectExtraction) => {
      await plugin.projectsPlusManager.createProject({
        name: extraction.name,
        description: extraction.description,
      });
      setView("list");
    },
    [plugin.projectsPlusManager]
  );

  /**
   * Handle project creation cancellation
   */
  const handleProjectCreationCancel = useCallback(() => {
    setView("list");
  }, []);

  const handleUpdateProject = useCallback(
    async (input: UpdateProjectInput) => {
      if (editingProject) {
        await plugin.projectsPlusManager.updateProject(editingProject.id, input);
        setEditingProject(null);
      }
    },
    [plugin.projectsPlusManager, editingProject]
  );

  const handleCompleteProject = useCallback(
    async (projectId: string) => {
      await plugin.projectsPlusManager.completeProject(projectId);
    },
    [plugin.projectsPlusManager]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      await plugin.projectsPlusManager.deleteProject(projectId);
    },
    [plugin.projectsPlusManager]
  );

  const handleEditProject = useCallback((project: Project) => {
    setEditingProject(project);
  }, []);

  // Render project creation view
  if (view === "create") {
    return (
      <ProjectCreation
        onCancel={handleProjectCreationCancel}
        onComplete={handleProjectCreationComplete}
        projectManager={plugin.projectsPlusManager}
      />
    );
  }

  // Render project list view
  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-p-4">
      {/* Header */}
      <div className="tw-mb-4 tw-flex tw-items-center tw-justify-between">
        <h2 className="tw-text-lg tw-font-semibold tw-text-normal">Projects+</h2>
        <Button
          size="sm"
          onClick={() => setView("create")}
          className="tw-flex tw-items-center tw-gap-1"
        >
          <Plus className="tw-size-4" />
          New Project
        </Button>
      </div>

      {/* Search bar */}
      <div className="tw-mb-4 tw-flex tw-gap-2">
        <div className="tw-relative tw-flex-1">
          <Search className="tw-absolute tw-left-2 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-muted" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="tw-pl-8"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterStatus)}
          className="tw-rounded-md tw-border tw-border-border tw-bg-primary tw-px-3 tw-py-1 tw-text-sm tw-text-normal"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Project list */}
      <div className="tw-flex-1 tw-overflow-y-auto">
        <ProjectList
          projects={filteredProjects}
          onEditProject={handleEditProject}
          onCompleteProject={handleCompleteProject}
          onDeleteProject={handleDeleteProject}
        />
      </div>

      {/* Edit dialog */}
      <ProjectDialog
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
        project={editingProject ?? undefined}
        onSave={handleUpdateProject}
        title="Edit Project"
      />
    </div>
  );
}
