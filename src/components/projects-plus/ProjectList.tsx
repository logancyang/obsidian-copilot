import { Project } from "@/types/projects-plus";
import { Target } from "lucide-react";
import * as React from "react";
import ProjectCard from "./ProjectCard";

interface ProjectListProps {
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onEditProject: (project: Project) => void;
  onCompleteProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}

/**
 * ProjectList - Renders a list of project cards or empty state
 */
export default function ProjectList({
  projects,
  onSelectProject,
  onEditProject,
  onCompleteProject,
  onDeleteProject,
}: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-12 tw-text-muted">
        <Target className="tw-mb-4 tw-size-12 tw-opacity-50" />
        <p className="tw-text-base tw-font-medium">No projects yet</p>
        <p className="tw-text-sm tw-text-faint">Create your first project to get started</p>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onClick={() => onSelectProject(project.id)}
          onEdit={() => onEditProject(project)}
          onComplete={() => onCompleteProject(project.id)}
          onDelete={() => onDeleteProject(project.id)}
        />
      ))}
    </div>
  );
}
