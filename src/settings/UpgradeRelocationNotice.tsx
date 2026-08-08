import { FolderRelocationEntry } from "@/settings/upgradeNotice";
import { FolderSync } from "lucide-react";
import React from "react";

/**
 * Body of the one-time "Copilot folders have moved" modal shown after a v3→v4
 * upgrade to a user whose data needs relocating (a folder was customized, or the
 * root itself moved). Leads with a folder-sync icon header, states that files
 * were not moved, then lists each folder that needs relocating as `old → new`.
 */
export function UpgradeRelocationNotice({
  entries,
}: {
  entries: readonly FolderRelocationEntry[];
}) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-items-center tw-gap-3 tw-text-normal">
        <FolderSync className="tw-size-6 tw-shrink-0 tw-text-accent" />
        <h2 className="tw-m-0 tw-text-xl tw-font-bold">Copilot folders have moved</h2>
      </div>
      <p className="tw-m-0 tw-text-muted">
        Copilot now keeps everything under one folder. Your files weren&apos;t moved — move them
        over if you want Copilot to keep using them (Obsidian updates the links automatically).
      </p>
      <ul className="tw-m-0 tw-flex tw-flex-col tw-gap-1.5 tw-pl-4 tw-text-muted">
        {entries.map((entry) => (
          <li key={entry.label}>
            {entry.label}: <code>{entry.oldPath}</code> → <code>{entry.newPath}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
