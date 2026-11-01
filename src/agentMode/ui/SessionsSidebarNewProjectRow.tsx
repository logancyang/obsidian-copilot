import { Input } from "@/components/ui/input";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import React from "react";

interface SessionsSidebarNewProjectRowProps {
  name: string;
  saving: boolean;
  error?: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const SessionsSidebarNewProjectRow: React.FC<SessionsSidebarNewProjectRowProps> = ({
  name,
  saving,
  error,
  onNameChange,
  onSubmit,
  onCancel,
}) => (
  <div className="tw-flex tw-flex-col tw-gap-1 tw-px-2 tw-py-1">
    <div className="tw-flex tw-items-center tw-gap-2">
      <ProjectFolderIcon />
      <Input
        autoFocus
        aria-label="Project name"
        aria-invalid={error ? true : undefined}
        placeholder="Project name"
        value={name}
        readOnly={saving}
        className="!tw-h-7"
        onChange={(event) => onNameChange(event.target.value)}
        onBlur={() => {
          if (!name.trim() && !saving) onCancel();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!saving) onSubmit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
    {error && (
      <div role="alert" className="tw-text-xs tw-text-error">
        {error}
      </div>
    )}
  </div>
);
