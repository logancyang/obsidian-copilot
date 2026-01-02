import CopilotPlugin from "@/main";
import {
  Project,
  ProjectStatus,
  CreateProjectInput,
  UpdateProjectInput,
  NoteSuggestion,
} from "@/types/projects-plus";
import { Plus, Search } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ProjectList from "./ProjectList";
import ProjectDialog from "./ProjectDialog";
import { ProjectCreationDialog } from "./ProjectCreationDialog";
import { ProjectDetail } from "./ProjectDetail";

interface ProjectsPanelProps {
  plugin: CopilotPlugin;
}

type FilterStatus = ProjectStatus | "all";

/**
 * ProjectsPanel - Main container for the Projects+ interface
 *
 * Displays project list with search/filter capabilities and
 * provides project creation functionality via AI-assisted dialog.
 */
export default function ProjectsPanel({ plugin }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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
        (p) => p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
      );
    }

    // Sort by most recently updated
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects, filter, searchQuery]);

  /**
   * Handle project creation from dialog
   * Returns the created project for note assignment step
   */
  const handleProjectCreated = useCallback(
    async (input: CreateProjectInput): Promise<Project> => {
      return await plugin.projectsPlusManager.createProject(input);
    },
    [plugin.projectsPlusManager]
  );

  /**
   * Handle adding notes to a project
   */
  const handleAddNotes = useCallback(
    async (projectId: string, suggestions: NoteSuggestion[]) => {
      const relevanceScores = new Map(suggestions.map((s) => [s.path, s.relevanceScore]));
      await plugin.projectsPlusManager.addNotesToProject(
        projectId,
        suggestions.map((s) => s.path),
        relevanceScores
      );
    },
    [plugin.projectsPlusManager]
  );

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

  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedProjectId(null);
  }, []);

  // Show project detail view when a project is selected
  if (selectedProjectId !== null) {
    return (
      <ProjectDetail projectId={selectedProjectId} plugin={plugin} onBack={handleBackToList} />
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-p-4">
      {/* Header */}
      <div className="tw-mb-4 tw-flex tw-items-center tw-justify-between">
        <h2 className="tw-text-lg tw-font-semibold tw-text-normal">Projects+</h2>
        <Button
          size="sm"
          onClick={() => setCreateDialogOpen(true)}
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
          className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-1 tw-text-sm tw-text-normal"
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
          onSelectProject={handleSelectProject}
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

      {/* Create dialog */}
      <ProjectCreationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onProjectCreated={handleProjectCreated}
        onAddNotes={handleAddNotes}
        noteAssignmentService={plugin.noteAssignmentService}
        onOpenNote={(path) => plugin.app.workspace.openLinkText(path, "")}
      />
    </div>
  );
}
