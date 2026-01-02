import { Project, ProjectStatus } from "@/types/projects-plus";

/**
 * Journey summary for a project
 */
export interface JourneySummary {
  daysActive: number;
  notesCount: number;
  conversationsCount: number;
}

/**
 * Get Tailwind classes for status badge styling
 */
export function getStatusBadgeStyles(status: ProjectStatus): string {
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
 * Format a timestamp to relative time string
 */
export function formatRelativeTime(timestamp: number): string {
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
 * Calculate journey summary for a project
 */
export function calculateJourneySummary(project: Project): JourneySummary {
  const now = Date.now();
  const daysActive = Math.max(1, Math.ceil((now - project.createdAt) / (1000 * 60 * 60 * 24)));
  return {
    daysActive,
    notesCount: project.notes.length,
    conversationsCount: project.conversations.length,
  };
}

/**
 * Format a date for display
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
