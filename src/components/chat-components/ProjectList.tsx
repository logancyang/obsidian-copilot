import { ProjectConfig, setCurrentProject } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/AddProjectModal";
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
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Edit2,
  Folder,
  Info,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { App } from "obsidian";
import React, { memo, useEffect, useState } from "react";

function ProjectItem({
  project,
  loadContext,
  onEdit,
}: {
  project: ProjectConfig;
  loadContext: (project: ProjectConfig) => void;
  onEdit: (project: ProjectConfig) => void;
}) {
  return (
    <div
      className="flex gap-2 p-3 justify-between items-center rounded-lg bg-secondary/40 border border-border border-solid group transition-all duration-200 hover:border-interactive-accent/30 hover:bg-interactive-accent/5 hover:shadow-[0_2px_12px_rgba(0,0,0,0.1)] active:scale-[0.98] cursor-pointer"
      onClick={() => loadContext(project)}
    >
      <div className="flex items-center gap-2 flex-1 overflow-hidden">
        <div className="text-blue-400">
          <Folder className="size-4" />
        </div>
        <div className="flex flex-col gap-1.5 flex-1 overflow-hidden">
          <span className="text-[13px] font-medium text-normal text-ellipsis overflow-hidden whitespace-nowrap w-full">
            {project.name}
          </span>
          {project.description && (
            <span className="text-[12px] text-muted/80 text-ellipsis overflow-hidden whitespace-nowrap w-full">
              {project.description}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-row gap-1 opacity-100 transition-opacity duration-200">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              className="h-6 w-6 hover:bg-accent/10 hover:text-accent-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(project);
              }}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Edit Project</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              className="h-6 w-6 hover:bg-accent/10 hover:text-accent-foreground"
              onClick={(e) => {
                e.stopPropagation();
                loadContext(project);
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Start Chat</TooltipContent>
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

    // Auto collapse when messages appear
    useEffect(() => {
      if (hasMessages) {
        setIsOpen(false);
      }
    }, [hasMessages]);

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
      <div className={cn("flex flex-col", className)}>
        <div className="overflow-y-auto">
          <div className="flex flex-col">
            {showChatInput && selectedProject ? (
              <div className="flex justify-between items-center px-2 py-3">
                <div className="flex gap-2 items-center">
                  <span className="font-semibold text-normal">Projects</span>
                  <Select
                    value={selectedProject.name}
                    onValueChange={(value) => {
                      const project = projects.find((p) => p.name === value);
                      if (project) {
                        handleLoadContext(project);
                      }
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          <Folder className="size-4 text-accent/70" />
                          <span>{selectedProject.name}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.name} value={project.name}>
                          <div className="flex items-center gap-2">
                            <Folder className="size-4" />
                            <span>{project.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="fit"
                        variant="ghost2"
                        onClick={() => handleEditProject(selectedProject)}
                        className="hover:bg-accent/50 hover:text-on-accent"
                      >
                        <Edit2 className="size-4 mr-1" />
                        Edit
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Edit Current Project</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => {
                          enableOrDisableProject(false);
                        }}
                        aria-label="Close Current Project"
                      >
                        <X className="size-4" />
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
                className="transition-all duration-200 ease-in-out"
              >
                <div className="flex justify-between items-center px-4 py-3">
                  <div className="flex gap-2 items-center flex-1">
                    <span className="font-semibold text-normal">Projects</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-4 text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="w-64">
                        Manage your projects with different contexts and configurations.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="fit" onClick={handleAddProject}>
                          Create
                          <Plus className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Add New Project</TooltipContent>
                    </Tooltip>
                    {projects.length > 0 && (
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost2" size="icon">
                          {isOpen ? (
                            <ChevronUp className="size-5" />
                          ) : (
                            <ChevronDown className="size-5" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => onClose()}
                          aria-label="close project mode"
                        >
                          <X className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Close Project Mode</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                {projects.length === 0 && (
                  <div className="px-4 py-2 text-xs text-muted bg-secondary/30">
                    No projects available
                  </div>
                )}
                <CollapsibleContent className="transition-all duration-200 ease-in-out">
                  <div className="relative bg-secondary/30">
                    <div className="px-4 pt-3 pb-6 max-h-[calc(3*5.7rem)] overflow-y-auto">
                      <div className="flex flex-col gap-2 @2xl:grid @2xl:grid-cols-2 @4xl:grid-cols-3">
                        {projects.map((project) => (
                          <ProjectItem
                            key={project.name}
                            project={project}
                            loadContext={handleLoadContext}
                            onEdit={handleEditProject}
                          />
                        ))}
                      </div>
                    </div>
                    {projects.length > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 h-6"
                        style={{
                          background: "linear-gradient(transparent, var(--background-primary) 75%)",
                        }}
                      />
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>

          {!showChatInput && (
            <div className="flex flex-col gap-4 items-center justify-center p-8 text-muted bg-secondary/30">
              <div className="max-w-[600px] space-y-4">
                <p className="text-base text-center">
                  Create and explore personalized AI assistants with custom instructions, knowledge
                  bases, and skill sets for each project.
                </p>
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="size-4" />
                    <span>Click a project card to start chatting</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BookOpen className="size-4" />
                    <span>
                      The more you use a project, the deeper the AI&#39;s understanding becomes
                    </span>
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
