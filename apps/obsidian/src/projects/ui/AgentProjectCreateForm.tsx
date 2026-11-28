import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { ProjectConfig } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { logError } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { err2String, randomUUID } from "@/utils";
import { Notice, type App } from "obsidian";
import React, { useState } from "react";

interface AgentProjectCreateFormProps {
  title?: string;
  subtitle?: string;
  onSave: (data: { name: string }) => Promise<void>;
  onCancel: () => void;
}

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

export function makeNewProjectConfig(name: string): ProjectConfig {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    systemPrompt: "",
    contextSource: { inclusions: "", exclusions: "", webUrls: "", youtubeUrls: "" },
    created: now,
    UsageTimestamps: now,
  };
}

export async function createProjectAndEnter(
  app: App,
  manager: AgentSessionManager,
  name: string
): Promise<void> {
  const project = makeNewProjectConfig(name);
  try {
    await ProjectFileManager.getInstance(app).createProject(project);
    await manager.enterProject(project.id);
  } catch (e) {
    logError("[AgentMode] create project failed", e);
    throw e;
  }
}
