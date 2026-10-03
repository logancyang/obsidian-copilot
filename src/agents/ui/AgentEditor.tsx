import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ObsidianNativeSelect, type SelectOption } from "@/components/ui/obsidian-native-select";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BookOpen,
  Eraser,
  ExternalLink,
  ImageUp,
  Layers,
  NotebookPen,
  Trash2,
  X,
} from "lucide-react";
import React, { useRef } from "react";

export interface AgentEditorDraft {
  name: string;
  description: string;
  instructions: string;
  backendId: string;
  modelId: string;
  effort: string;
  memoryEnabled: boolean;
  avatarSrc: string | null;
}

export interface AgentEditorMemory {
  sizeLabel: string;
  onOpenMemory: () => void;
  onOpenTodaysNotes: () => void;
  onConsolidate: () => void;
  onClear: () => void;
}

export interface AgentEditorProps {
  mode: "create" | "edit";
  slug: string | null;
  draft: AgentEditorDraft;
  onChange: (patch: Partial<AgentEditorDraft>) => void;
  onPickAvatar: (file: File) => void;
  onRemoveAvatar: () => void;
  backendOptions: readonly SelectOption[];
  modelOptions: readonly SelectOption[];
  effortOptions: readonly SelectOption[];
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onOpenInEditor?: () => void;
  memory?: AgentEditorMemory;
  onDelete?: () => void;
}

export const AgentEditor: React.FC<AgentEditorProps> = ({
  mode,
  slug,
  draft,
  onChange,
  onPickAvatar,
  onRemoveAvatar,
  backendOptions,
  modelOptions,
  effortOptions,
  error,
  saving,
  onSave,
  onCancel,
  onOpenInEditor,
  memory,
  onDelete,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSave = draft.name.trim().length > 0 && !saving;
  const backendPinned = draft.backendId.length > 0;
  const modelPinned = backendPinned && draft.modelId.length > 0;
  const title = draft.name.trim() || (mode === "create" ? "New agent" : "Untitled agent");

  return (
    <div className="tw-flex tw-flex-col tw-gap-6">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <Button variant="ghost2" size="fit" onClick={onCancel} className="tw-gap-1.5 tw-text-muted">
          <ArrowLeft className="tw-size-4" aria-hidden="true" />
          <span className="tw-text-ui-small">Agents</span>
        </Button>
        <div className="tw-flex tw-gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="default" onClick={onSave} disabled={!canSave}>
            {saving ? "Saving…" : mode === "create" ? "Create agent" : "Save"}
          </Button>
        </div>
      </div>

      {error !== null && (
        <div role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </div>
      )}

      <div className="tw-flex tw-items-center tw-gap-4">
        <AgentAvatar src={draft.avatarSrc} name={draft.name} size="xl" />
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-2">
          <div
            role="heading"
            aria-level={3}
            className="tw-truncate tw-text-ui-larger tw-font-semibold tw-text-normal"
          >
            {title}
          </div>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <ImageUp className="tw-size-3.5" aria-hidden="true" />
              {draft.avatarSrc ? "Change image" : "Upload image"}
            </Button>
            {draft.avatarSrc && (
              <Button variant="ghost2" size="sm" onClick={onRemoveAvatar}>
                <X className="tw-size-3.5" aria-hidden="true" />
                Remove
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Profile image"
              className="tw-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onPickAvatar(file);
              }}
            />
          </div>
          <div className="tw-text-ui-smaller tw-text-faint">
            {slug === null
              ? "Stored in the agent's folder, which is named after the agent when you create it."
              : `Stored in the agent's folder: ${slug}/`}
          </div>
        </div>
      </div>

      <EditorSection title="Profile">
        <FormField label="Name" required>
          <Input
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Jennifer"
            aria-label="Name"
            className="tw-w-full"
          />
        </FormField>
        <FormField label="Description">
          <Input
            value={draft.description}
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder="Skeptical editor. Cuts fluff, argues for the reader."
            aria-label="Description"
            className="tw-w-full"
          />
        </FormField>
      </EditorSection>

      <EditorSection
        title="Instructions"
        action={
          onOpenInEditor && (
            <Button variant="ghost2" size="fit" onClick={onOpenInEditor} className="tw-gap-1.5">
              <ExternalLink className="tw-size-3.5" aria-hidden="true" />
              Open agent.md
            </Button>
          )
        }
      >
        <Textarea
          value={draft.instructions}
          onChange={(event) => onChange({ instructions: event.target.value })}
          placeholder="How this agent should behave, in its own standing voice…"
          aria-label="Instructions"
          className="tw-min-h-[220px] tw-w-full"
        />
      </EditorSection>

      <EditorSection title="Model">
        <div className="tw-grid tw-grid-cols-1 tw-gap-3 sm:tw-grid-cols-3">
          <FormField label="Backend">
            <ObsidianNativeSelect
              value={draft.backendId}
              onChange={(event) =>
                onChange({ backendId: event.target.value, modelId: "", effort: "" })
              }
              options={[...backendOptions]}
              aria-label="Backend"
            />
          </FormField>
          <FormField label="Model">
            <ObsidianNativeSelect
              value={draft.modelId}
              onChange={(event) => onChange({ modelId: event.target.value, effort: "" })}
              options={[...modelOptions]}
              disabled={!backendPinned}
              aria-label="Model"
            />
          </FormField>
          <FormField label="Effort">
            <ObsidianNativeSelect
              value={draft.effort}
              onChange={(event) => onChange({ effort: event.target.value })}
              options={[...effortOptions]}
              disabled={!modelPinned || effortOptions.length <= 1}
              aria-label="Effort"
            />
          </FormField>
        </div>
      </EditorSection>

      <EditorSection title="Memory">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          <div className="tw-min-w-0">
            <div className="tw-text-ui-small tw-font-medium tw-text-normal">
              Remember conversations
            </div>
            <div className="tw-text-ui-smaller tw-text-muted">
              {memory && draft.memoryEnabled
                ? `Keeps notes after each chat and folds them into MEMORY.md (${memory.sizeLabel}).`
                : "Keeps notes after each chat and folds them into its own MEMORY.md."}
            </div>
          </div>
          <SettingSwitch
            checked={draft.memoryEnabled}
            onCheckedChange={(checked) => onChange({ memoryEnabled: checked })}
            aria-label="Memory"
          />
        </div>
        {memory && (
          <div className="tw-flex tw-flex-wrap tw-gap-2">
            <Button variant="secondary" size="sm" onClick={memory.onOpenMemory}>
              <BookOpen className="tw-size-3.5" aria-hidden="true" />
              Open MEMORY.md
            </Button>
            <Button variant="secondary" size="sm" onClick={memory.onOpenTodaysNotes}>
              <NotebookPen className="tw-size-3.5" aria-hidden="true" />
              Today&apos;s notes
            </Button>
            <Button variant="secondary" size="sm" onClick={memory.onConsolidate}>
              <Layers className="tw-size-3.5" aria-hidden="true" />
              Consolidate now
            </Button>
            <Button variant="secondary" size="sm" onClick={memory.onClear}>
              <Eraser className="tw-size-3.5" aria-hidden="true" />
              Clear memory…
            </Button>
          </div>
        )}
      </EditorSection>

      {onDelete && (
        <EditorSection title="Delete">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <div className="tw-text-ui-smaller tw-text-muted">
              Moves the agent&apos;s folder, memory included, to the trash. Past chats keep their
              transcripts.
            </div>
            <Button variant="destructive" size="sm" onClick={onDelete} className="tw-shrink-0">
              <Trash2 className="tw-size-3.5" aria-hidden="true" />
              Delete agent…
            </Button>
          </div>
        </EditorSection>
      )}
    </div>
  );
};

const EditorSection: React.FC<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, action, children }) => (
  <section
    className={cn(
      "tw-flex tw-flex-col tw-gap-3 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-4"
    )}
  >
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
      <div role="heading" aria-level={4} className="tw-text-ui-medium tw-font-semibold">
        {title}
      </div>
      {action}
    </div>
    {children}
  </section>
);
