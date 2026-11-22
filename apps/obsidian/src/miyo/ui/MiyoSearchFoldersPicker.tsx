import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { MiyoSearchFolderOption } from "@/miyo/miyoUtils";
import { Loader2, XCircle } from "lucide-react";
import React from "react";

export interface MiyoSearchFoldersPickerProps {
  folders?: readonly MiyoSearchFolderOption[];
  error?: string;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}

export function MiyoSearchFoldersPicker({
  folders,
  error,
  selected,
  onChange,
}: MiyoSearchFoldersPickerProps) {
  const listed = new Set(folders?.map((folder) => folder.name));
  const rows = [
    ...(folders ?? []).map((folder) => ({ ...folder, missing: false })),
    // A ticked folder this Miyo lacks, such as one synced from another device, stays
    // listed so the user can untick it. https://github.com/logancyang/obsidian-copilot/issues/3508
    ...selected
      .filter((name) => !listed.has(name))
      .map((name) => ({ name, isChat: false, missing: true })),
  ];

  return (
    <div className="tw-space-y-2 tw-pb-4">
      <div className="tw-text-xs tw-text-muted">Also search these Miyo folders</div>
      {error ? (
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-error">
          <XCircle className="tw-size-3.5 tw-shrink-0" />
          <span>{error}</span>
        </div>
      ) : !folders ? (
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
          <Loader2 className="tw-size-3.5 tw-shrink-0 tw-animate-spin" />
          <span>Loading Miyo folders…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="tw-text-xs tw-text-muted">Miyo has no other folders yet.</div>
      ) : (
        <div className="tw-flex tw-flex-col tw-gap-2">
          {rows.map((row) => (
            <label
              key={row.name}
              className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-sm"
            >
              <Checkbox
                aria-label={row.name}
                checked={selected.includes(row.name)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, row.name]
                      : selected.filter((name) => name !== row.name)
                  )
                }
              />
              <span className="tw-truncate">{row.name}</span>
              {row.isChat && <Badge variant="secondary">Chat</Badge>}
              {row.missing && <Badge variant="outline">Not in Miyo</Badge>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
