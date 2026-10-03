import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ObsidianNativeSelect, type SelectOption } from "@/components/ui/obsidian-native-select";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import React from "react";

export interface AgentEditorDraft {
  name: string;
  icon: string;
  description: string;
  instructions: string;
  backendId: string;
  modelId: string;
  effort: string;
  memoryEnabled: boolean;
}

export interface AgentEditorProps {
  mode: "create" | "edit";
  slug: string | null;
  draft: AgentEditorDraft;
  onChange: (patch: Partial<AgentEditorDraft>) => void;
  backendOptions: readonly SelectOption[];
  modelOptions: readonly SelectOption[];
  effortOptions: readonly SelectOption[];
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onOpenInEditor?: () => void;
}

export const AgentEditor: React.FC<AgentEditorProps> = ({
  mode,
  slug,
  draft,
  onChange,
  backendOptions,
  modelOptions,
  effortOptions,
  error,
  saving,
  onSave,
  onCancel,
  onOpenInEditor,
}) => {
  const canSave = draft.name.trim().length > 0 && !saving;
  const backendPinned = draft.backendId.length > 0;
  const modelPinned = backendPinned && draft.modelId.length > 0;

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-col tw-gap-1">
        <div
          role="heading"
          aria-level={3}
          className="tw-text-left tw-text-base tw-font-semibold tw-text-normal"
        >
          {mode === "create" ? "New agent" : "Edit agent"}
        </div>
        <div className="tw-text-ui-smaller tw-text-muted">
          {slug === null
            ? "The folder name is taken from the name you choose and never changes afterwards."
            : `Folder: ${slug}`}
        </div>
      </div>

      <div className="tw-flex tw-gap-3">
        <div className="tw-w-20 tw-shrink-0">
          <FormField label="Icon">
            <Input
              value={draft.icon}
              onChange={(event) => onChange({ icon: event.target.value })}
              placeholder="🪶"
              aria-label="Icon"
              className="tw-w-full tw-text-center"
            />
          </FormField>
        </div>
        <div className="tw-min-w-0 tw-flex-1">
          <FormField label="Name" required>
            <Input
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="Jennifer"
              aria-label="Name"
              className="tw-w-full"
            />
          </FormField>
        </div>
      </div>

      <FormField label="Description">
        <Input
          value={draft.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="Skeptical editor. Cuts fluff, argues for the reader."
          aria-label="Description"
          className="tw-w-full"
        />
      </FormField>

      <FormField label="Instructions">
        <Textarea
          value={draft.instructions}
          onChange={(event) => onChange({ instructions: event.target.value })}
          placeholder="How this agent should behave, in its own standing voice…"
          aria-label="Instructions"
          className="tw-min-h-[160px] tw-w-full"
        />
      </FormField>
      {onOpenInEditor && (
        <button
          type="button"
          onClick={onOpenInEditor}
          className={cn(
            "tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0",
            "tw--mt-2 tw-flex tw-w-fit tw-cursor-pointer tw-items-center tw-gap-1.5",
            "tw-text-ui-smaller tw-text-accent hover:tw-underline"
          )}
        >
          <ExternalLink className="tw-size-3.5" aria-hidden="true" />
          Open in editor
        </button>
      )}

      <div className="tw-flex tw-gap-3">
        <div className="tw-min-w-0 tw-flex-1">
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
        </div>
        <div className="tw-min-w-0 tw-flex-1">
          <FormField label="Model">
            <ObsidianNativeSelect
              value={draft.modelId}
              onChange={(event) => onChange({ modelId: event.target.value, effort: "" })}
              options={[...modelOptions]}
              disabled={!backendPinned}
              aria-label="Model"
            />
          </FormField>
        </div>
        <div className="tw-min-w-0 tw-flex-1">
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
      </div>

      <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
        <div className="tw-min-w-0">
          <div className="tw-text-sm tw-font-medium tw-text-normal">Memory</div>
          <div className="tw-text-ui-smaller tw-text-muted">
            The agent keeps its own MEMORY.md and updates it after each conversation.
          </div>
        </div>
        <SettingSwitch
          checked={draft.memoryEnabled}
          onCheckedChange={(checked) => onChange({ memoryEnabled: checked })}
          aria-label="Memory"
        />
      </div>

      {error !== null && (
        <div role="alert" className="tw-text-ui-smaller tw-text-error">
          {error}
        </div>
      )}

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="default" onClick={onSave} disabled={!canSave}>
          {saving ? "Saving…" : mode === "create" ? "Create agent" : "Save"}
        </Button>
      </div>
    </div>
  );
};
