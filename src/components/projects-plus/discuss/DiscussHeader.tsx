/**
 * DiscussHeader - Header with project info and conversation title
 */

import { Button } from "@/components/ui/button";
import { Project } from "@/types/projects-plus";
import { ArrowLeft, Edit2, Plus } from "lucide-react";
import * as React from "react";

interface DiscussHeaderProps {
  project: Project;
  conversationTitle: string;
  onBack: () => void;
  onNewConversation: () => void;
  onRenameConversation: () => void;
}

/**
 * Header component for Discuss view
 */
export function DiscussHeader({
  project,
  conversationTitle,
  onBack,
  onNewConversation,
  onRenameConversation,
}: DiscussHeaderProps) {
  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-p-3">
      <Button variant="ghost2" size="icon" onClick={onBack} className="tw-shrink-0">
        <ArrowLeft className="tw-size-4" />
      </Button>

      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-truncate tw-text-xs tw-text-muted">{project.title}</div>
        <button
          onClick={onRenameConversation}
          className="tw-group tw-flex tw-items-center tw-gap-1 tw-text-sm tw-font-medium tw-text-normal hover:tw-text-accent"
        >
          <span className="tw-truncate">{conversationTitle}</span>
          <Edit2 className="tw-size-3 tw-shrink-0 tw-text-faint tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100" />
        </button>
      </div>

      <Button
        variant="ghost2"
        size="icon"
        onClick={onNewConversation}
        title="New conversation"
        className="tw-shrink-0"
      >
        <Plus className="tw-size-4" />
      </Button>
    </div>
  );
}
