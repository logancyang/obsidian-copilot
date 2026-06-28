import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal, Notice } from "obsidian";
import React, { useState } from "react";
import { Root } from "react-dom/client";

interface ProjectSystemPromptModalContentProps {
  initialPrompt: string;
  onSave: (prompt: string) => Promise<void>;
  onCancel: () => void;
}

function ProjectSystemPromptModalContent({
  initialPrompt,
  onSave,
  onCancel,
}: ProjectSystemPromptModalContentProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(prompt);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        autoFocus
        rows={6}
        className="tw-min-h-24 tw-text-ui-small"
        placeholder="Instructions the agent receives in every chat of this project…"
      />
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="default" onClick={handleSave} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Lightweight editor for a project's system prompt (the "System Prompt" row
 * in the project-info popover) — the F3 frame of the design handoff. A small
 * native Modal (popout-correct, ESC handling) instead of the full Edit
 * Project modal: a single textarea. No `{[[note]]}` template hints here —
 * those variables are expanded by legacy chat's prompt processor only; agent
 * backends receive the prompt verbatim.
 *
 * Saving persists via the caller; the prompt is captured per session at
 * create/resume time on every backend, so edits apply to NEW chats only —
 * the Notice says so explicitly.
 */
export class ProjectSystemPromptModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly initialPrompt: string,
    private readonly persist: (prompt: string) => Promise<void>
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Edit System Prompt");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);
    this.root.render(
      <ProjectSystemPromptModalContent
        initialPrompt={this.initialPrompt}
        onCancel={() => this.close()}
        onSave={async (prompt) => {
          try {
            await this.persist(prompt);
            new Notice("System prompt saved. Applies to new chats.");
            this.close();
          } catch (e) {
            logError("[ProjectSystemPromptModal] save failed", e);
            new Notice("Failed to save the system prompt.");
          }
        }}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
