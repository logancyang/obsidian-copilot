import { Project, ProjectStatus } from "@/types/projects-plus";
import { Check, Edit, FileText, MessageSquare, MoreVertical, Trash2 } from "lucide-react";
import * as React from "react";
import { useState } from "react";

interface ProjectCardProps {
  project: Project;
  onEdit: () => void;
  onComplete: () => void;
  onDelete: () => void;
}

/**
 * Get badge styling based on project status
 */
function getStatusBadgeStyles(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "tw-bg-interactive-accent-hsl/20 tw-text-accent";
    case "completed":
      return "tw-bg-success tw-text-success";
    case "archived":
      return "tw-bg-secondary tw-text-muted";
    default:
      return "tw-bg-secondary tw-text-muted";
  }
}

/**
 * Format a timestamp to relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return "just now";
}

/**
 * ProjectCard - Individual project card with actions
 */
export default function ProjectCard({ project, onEdit, onComplete, onDelete }: ProjectCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handleAction = (action: () => void) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowMenu(false);
      action();
    };
  };

  return (
    <div
      className="tw-cursor-pointer tw-rounded-md tw-border tw-border-border tw-bg-primary tw-p-3 tw-transition-colors hover:tw-bg-modifier-hover"
      onClick={onEdit}
    >
      {/* Header with title and status */}
      <div className="tw-mb-2 tw-flex tw-items-start tw-justify-between tw-gap-2">
        <h3 className="tw-line-clamp-1 tw-text-base tw-font-medium tw-text-normal">
          {project.name}
        </h3>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span
            className={`tw-rounded-sm tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-capitalize ${getStatusBadgeStyles(project.status)}`}
          >
            {project.status}
          </span>

          {/* Menu button */}
          <div className="tw-relative">
            <button
              onClick={handleMenuClick}
              className="tw-rounded tw-p-1 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            >
              <MoreVertical className="tw-size-4" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <>
                <div
                  className="tw-fixed tw-inset-0 tw-z-modal"
                  onClick={() => setShowMenu(false)}
                />
                <div className="tw-absolute tw-right-0 tw-top-full tw-z-menu tw-mt-1 tw-min-w-[140px] tw-rounded-md tw-border tw-border-border tw-bg-primary tw-py-1 tw-shadow-lg">
                  <button
                    onClick={handleAction(onEdit)}
                    className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-text-sm tw-text-normal hover:tw-bg-modifier-hover"
                  >
                    <Edit className="tw-size-4" />
                    Edit
                  </button>
                  {project.status === "active" && (
                    <button
                      onClick={handleAction(onComplete)}
                      className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-text-sm tw-text-normal hover:tw-bg-modifier-hover"
                    >
                      <Check className="tw-size-4" />
                      Complete
                    </button>
                  )}
                  <button
                    onClick={handleAction(onDelete)}
                    className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-text-sm tw-text-error hover:tw-bg-modifier-hover"
                  >
                    <Trash2 className="tw-size-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description preview */}
      {project.description && (
        <p className="tw-mb-3 tw-line-clamp-2 tw-text-sm tw-text-muted">{project.description}</p>
      )}

      {/* Stats and timestamp */}
      <div className="tw-flex tw-items-center tw-justify-between tw-text-xs tw-text-faint">
        <div className="tw-flex tw-items-center tw-gap-3">
          <span className="tw-flex tw-items-center tw-gap-1">
            <FileText className="tw-size-3" />
            {project.notes.length} notes
          </span>
          <span className="tw-flex tw-items-center tw-gap-1">
            <MessageSquare className="tw-size-3" />
            {project.conversations.length} conversations
          </span>
        </div>
        <span>{formatRelativeTime(project.updatedAt)}</span>
      </div>
    </div>
  );
}
