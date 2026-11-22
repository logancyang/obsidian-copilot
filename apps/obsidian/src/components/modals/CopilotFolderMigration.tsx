import type { HiddenFolderMigration } from "@/settings/revealCopilotFolder";
import React from "react";

export interface CopilotFolderMigrationProps {
  migration: HiddenFolderMigration;
}

export function CopilotFolderMigration({ migration }: CopilotFolderMigrationProps) {
  const { from, to } = migration;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-whitespace-normal">
      <p className="tw-m-0">
        Copilot no longer supports hidden folders. Your Copilot folder &quot;{from}&quot; must move
        to a visible folder before Copilot can use it again.
      </p>
      {migration.status === "failed" ? (
        <p className="tw-m-0">
          Copilot could not move it: {migration.reason}. Move the contents of &quot;{from}&quot; to
          &quot;{to}&quot; yourself.
        </p>
      ) : migration.leftBehind.length === 0 ? (
        <p className="tw-m-0">Your Copilot folder is now &quot;{to}&quot;.</p>
      ) : (
        <>
          <p className="tw-m-0">
            Your Copilot folder is now &quot;{to}&quot;. These files stayed in &quot;{from}&quot;
            because &quot;{to}&quot; already has files with the same names. Move or merge them
            yourself:
          </p>
          <ul className="tw-m-0 tw-max-h-48 tw-overflow-y-auto tw-pl-5 tw-text-muted">
            {migration.leftBehind.map((path) => (
              <li key={path} className="tw-break-words">
                {path}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
