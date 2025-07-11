import { ProjectConfig, setCurrentProject } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { updateSetting } from "@/settings/model";
import {
  ChevronDown,
  ChevronUp,
  Edit2,
  Folder,
  Info,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { App, Notice } from "obsidian";
import React, { memo, useEffect, useMemo, useState } from "react";
import { filterProjects } from "@/utils/projectUtils";

function ProjectItem({
  project,
  loadContext,
  onEdit,
  onDelete,
}: {
  project: ProjectConfig;
  loadContext: (project: ProjectConfig) => void;
  onEdit: (project: ProjectConfig) => void;
  onDelete: (project: ProjectConfig) => void;
}) {
  return (
    <div
      className="tw-group tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3 tw-transition-all tw-duration-200 tw-bg-secondary/40 hover:tw-border-interactive-accent hover:tw-text-accent hover:tw-shadow-[0_2px_12px_rgba(0,0,0,0.1)] active:tw-scale-[0.98]"
      onClick={() => loadContext(project)}
    >
      <div className="tw-flex tw-flex-1 tw-items-center tw-gap-2 tw-overflow-hidden">
        <div className="tw-text-accent">
          <Folder className="tw-size-4" />
        </div>
        <div className="tw-flex tw-flex-1 tw-flex-col tw-gap-1.5 tw-overflow-hidden">
          <span className="tw-w-full tw-truncate tw-text-[13px] tw-font-medium tw-text-normal">
            {project.name}
          </span>
          {project.description && (
            <span className="tw-w-full tw-truncate tw-text-[12px] tw-text-muted/80">
              {project.description}
            </span>
          )}
        </div>
      </div>
      <div className="tw-flex tw-flex-row tw-items-center tw-gap-1 tw-opacity-100 tw-transition-opacity tw-duration-200">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(project);
              }}
            >
              <Edit2 className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Edit Project</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                loadContext(project);
              }}
            >
              <MessageSquare className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Start Chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                const modal = new ConfirmModal(
                  app,
                  () => onDelete(project),
                  `Are you sure you want to delete project "${project.name}"?`,
                  "Delete Project"
                );
                modal.open();
              }}
            >
              <Trash2 className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Delete Project</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export const ProjectList = memo(
  ({
    className,
    projects,
    defaultOpen = false,
    app,
    onProjectAdded,
    onEditProject,
    hasMessages = false,
    showChatUI,
    onClose,
    inputRef,
  }: {
    className?: string;
    projects: ProjectConfig[];
    defaultOpen?: boolean;
    app: App;
    onProjectAdded: (project: ProjectConfig) => void;
    onEditProject: (originP: ProjectConfig, updateP: ProjectConfig) => void;
    hasMessages?: boolean;
    showChatUI: (v: boolean) => void;
    onClose: () => void;
    inputRef: React.RefObject<HTMLTextAreaElement>;
  }): React.ReactElement => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [showChatInput, setShowChatInput] = useState(false);
    const [selectedProject, setSelectedProject] = useState<ProjectConfig | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    // Auto collapse when messages appear
    useEffect(() => {
      if (hasMessages) {
        setIsOpen(false);
      }
    }, [hasMessages]);

    // Filter projects based on search query
    const filteredProjects = useMemo(() => {
      return filterProjects(projects, searchQuery);
    }, [projects, searchQuery]);

    const handleAddProject = () => {
      const modal = new AddProjectModal(app, async (project: ProjectConfig) => {
        onProjectAdded(project);
      });
      modal.open();
    };

    const handleEditProject = (originP: ProjectConfig) => {
      const modal = new AddProjectModal(
        app,
        async (updatedProject: ProjectConfig) => {
          onEditProject(originP, updatedProject);
          if (selectedProject && selectedProject.name === originP.name) {
            setSelectedProject(updatedProject);
          }
        },
        originP
      );
      modal.open();
    };

    const handleDeleteProject = (project: ProjectConfig) => {
      const currentProjects = projects || [];
      const newProjectList = currentProjects.filter((p) => p.name !== project.name);

      // If the deleted project is currently selected, close it
      if (selectedProject?.name === project.name) {
        enableOrDisableProject(false);
      }

      // Update the project list in settings
      updateSetting("projectList", newProjectList);
      new Notice(`Project "${project.name}" deleted successfully`);
    };

    const enableOrDisableProject = (enable: boolean, project?: ProjectConfig) => {
      if (!enable) {
        setSelectedProject(null);
        setShowChatInput(false);
        setIsOpen(true);
        showChatUI(false);
        setCurrentProject(null);
        return;
      } else {
        if (!project) {
          logError("Must be exist one project.");
          return;
        }
        setSelectedProject(project);
        setShowChatInput(true);
        setIsOpen(false);
      }
    };

    const handleLoadContext = (p: ProjectConfig) => {
      setSelectedProject(p);
      setShowChatInput(true);
      setIsOpen(false);
      showChatUI(true);
      setCurrentProject(p);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 0);
    };

    return (
      <div className={cn("tw-flex tw-flex-col", className)}>
        <div className="tw-overflow-y-auto">
          <div className="tw-flex tw-flex-col">
            {showChatInput && selectedProject ? (
              <div className="tw-flex tw-items-center tw-justify-between tw-px-2 tw-py-3">
                <div className="tw-flex tw-items-center tw-gap-2">
                  <span className="tw-font-semibold tw-text-normal">Projects</span>
                  <Select
                    value={selectedProject.name}
                    onValueChange={(value) => {
                      const project = projects.find((p) => p.name === value);
                      if (project) {
                        handleLoadContext(project);
                      }
                    }}
                  >
                    <SelectTrigger className="tw-w-[200px]">
                      <SelectValue>
                        <div className="tw-flex tw-items-center tw-gap-2">
                          <Folder className="tw-size-4 tw-text-accent/70" />
                          <span>{selectedProject.name}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem
                          key={project.name}
                          value={project.name}
                          className="tw-flex tw-items-center tw-gap-2"
                        >
                          <div className="tw-flex tw-items-center tw-gap-2">
                            <Folder className="tw-size-4" />
                            {project.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tw-flex tw-items-center tw-gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => handleEditProject(selectedProject)}
                    className="hover:tw-text-on-accent hover:tw-bg-accent/50"
                  >
                    <Edit2 className="tw-mr-1 tw-size-4" />
                    Edit
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost2"
                        size="icon"
                        onClick={() => {
                          enableOrDisableProject(false);
                        }}
                        aria-label="Close Current Project"
                      >
                        <X className="tw-size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Close Current Project</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ) : (
              <Collapsible
                open={isOpen}
                onOpenChange={setIsOpen}
                className="tw-transition-all tw-duration-200 tw-ease-in-out"
              >
                <div className="tw-flex tw-items-center tw-justify-between tw-px-4 tw-py-3">
                  <div className="tw-flex tw-flex-1 tw-items-center tw-gap-2">
                    <span className="tw-font-semibold tw-text-normal">Projects</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="tw-size-4 tw-text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="tw-w-64">
                        Manage your projects with different contexts and configurations.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Button className="tw-px-2" variant="secondary" onClick={handleAddProject}>
                      Create
                      <Plus className="tw-size-3" />
                    </Button>
                    {projects.length > 0 && (
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost2" size="icon">
                          {isOpen ? (
                            <ChevronUp className="tw-size-5" />
                          ) : (
                            <ChevronDown className="tw-size-5" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost2"
                          size="icon"
                          onClick={() => onClose()}
                          aria-label="close project mode"
                        >
                          <X className="tw-size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Close Project Mode</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                {projects.length === 0 && (
                  <div className="tw-px-4 tw-py-2 tw-text-xs tw-text-muted tw-bg-secondary/30">
                    No projects available
                  </div>
                )}
                <CollapsibleContent className="tw-transition-all tw-duration-200 tw-ease-in-out">
                  <div className="tw-relative tw-bg-secondary/30">
                    {/* Search input box */}
                    {projects.length > 0 && (
                      <div className="tw-px-4 tw-pb-2 tw-pt-3">
                        <div className="tw-relative">
                          <SearchBar
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Search projects..."
                          />
                        </div>
                      </div>
                    )}
                    <div className="tw-max-h-[calc(3*5.7rem)] tw-overflow-y-auto tw-px-4 tw-pb-6 tw-pt-3">
                      <div className="tw-flex tw-flex-col tw-gap-2 @2xl:tw-grid @2xl:tw-grid-cols-2 @4xl:tw-grid-cols-3">
                        {filteredProjects.map((project) => (
                          <ProjectItem
                            key={project.name}
                            project={project}
                            loadContext={handleLoadContext}
                            onEdit={handleEditProject}
                            onDelete={handleDeleteProject}
                          />
                        ))}
                      </div>
                      {/* No search results message */}
                      {searchQuery.trim() && filteredProjects.length === 0 && (
                        <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-8 tw-text-muted">
                          <Search className="tw-mb-3 tw-size-12 tw-text-muted/50" />
                          <p className="tw-text-base tw-font-medium">No matching projects found</p>
                          <p className="tw-mt-1 tw-text-sm">
                            Try searching with different keywords
                          </p>
                        </div>
                      )}
                    </div>
                    {projects.length > 0 && (
                      <div className="tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-8 tw-bg-[linear-gradient(to_top,var(--background-primary)_0%,var(--background-primary)_30%,transparent_100%)]" />
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>

          {!showChatInput && (
            <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-4 tw-p-8 tw-text-muted tw-bg-secondary/30">
              <div className="tw-max-w-[600px] tw-space-y-4">
                <p className="tw-text-center tw-text-base">
                  Create your project-based AI assistants with custom instructions, context, and
                  model configurations.
                </p>
                <div className="tw-flex tw-flex-col tw-gap-3 tw-text-sm">
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <MessageSquare className="tw-size-4" />
                    <span>Click a project card to start chatting</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ProjectList.displayName = "ProjectList";
