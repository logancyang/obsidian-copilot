import { ProjectConfig } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { err2String, randomUUID } from "@/utils";
import { Notice } from "obsidian";
import React, { useState } from "react";

interface AgentProjectCreateFormProps {
  /**
   * Optional card title + one-line subtitle. The anchored create panel renders
   * the form as a titled card (design B.1); when `title` is set the name input
   * drops its "Name" label, since the subtitle already prompts for it.
   */
  title?: string;
  subtitle?: string;
  /** Resolve to close the panel; reject to surface a Notice and stay open. */
  onSave: (data: { name: string }) => Promise<void>;
  onCancel: () => void;
}

/**
 * Name-only "new project" form body, hosted by the anchored create panel
 * ({@link CreateProjectPanel}). Full project editing lives in AddProjectModal
 * (agent variant) — this form only creates. Exported for unit tests; the caller
 * owns persistence (mapping the name onto a {@link ProjectConfig}).
 */
export function AgentProjectCreateForm({
  title,
  subtitle,
  onSave,
  onCancel,
}: AgentProjectCreateFormProps): React.ReactElement {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canSave = name.trim().length > 0 && !isSaving;

  const handleSave = async () => {
    if (name.trim().length === 0 || isSaving) return;
    setIsSaving(true);
    try {
      await onSave({ name: name.trim() });
    } catch (e) {
      // Reason: createProject rejects on duplicate name etc. — keep the panel
      // open so the user can correct the field instead of losing input.
      new Notice(err2String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const nameInput = (
    <Input
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Project name"
      autoFocus
      onKeyDown={(e) => {
        // Enter submits straight from the single name field.
        if (e.key === "Enter") {
          e.preventDefault();
          void handleSave();
        }
      }}
      className="tw-w-full"
    />
  );

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {title && (
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-base tw-font-semibold tw-text-normal">{title}</div>
          {subtitle && <div className="tw-text-sm tw-text-muted">{subtitle}</div>}
        </div>
      )}
      {/* With a title card (create panel) the subtitle is the prompt, so the
          input drops the redundant "Name" label; otherwise keep the field. */}
      {title ? (
        nameInput
      ) : (
        <FormField label="Name" required>
          {nameInput}
        </FormField>
      )}

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="default" onClick={() => void handleSave()} disabled={!canSave}>
          {isSaving ? "Saving..." : "Create"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Build a fresh, valid {@link ProjectConfig} for a name-only create. Agent Mode
 * ignores the CAG model selector, so it's left empty rather than forcing a
 * meaningless choice at creation time. The single source of truth for the
 * new-project shape, used by the anchored create panel (`CreateProjectPanel`).
 */
export function makeNewProjectConfig(name: string): ProjectConfig {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: { inclusions: "", exclusions: "", webUrls: "", youtubeUrls: "" },
    created: now,
    UsageTimestamps: now,
  };
}
