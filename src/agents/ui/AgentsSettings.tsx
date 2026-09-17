import { AgentFileManager } from "@/agents/AgentFileManager";
import { isValidAgentIcon } from "@/agents/agentFile";
import { formatMemorySize } from "@/agents/agentDisplay";
import type { AgentDraft, AgentRecord } from "@/agents/types";
import { AgentDeleteConfirmModal } from "@/agents/ui/AgentDeleteConfirmModal";
import type { AgentEditorDraft, AgentEditorProps } from "@/agents/ui/AgentEditor";
import type { AgentRowItem } from "@/agents/ui/AgentRow";
import { AgentsSettingsView } from "@/agents/ui/AgentsSettingsView";
import { listBackendDescriptors } from "@/agentMode";
import type { SelectOption } from "@/components/ui/obsidian-native-select";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { deriveAgentsFolder } from "@/settings/copilotFolder";
import { useSettingsValue } from "@/settings/model";
import { openVaultPath } from "@/utils/openVaultPath";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Sentinel for "no pin" in both selects; the empty string is the unset value. */
const UNPINNED = "";
const SESSION_BACKEND_OPTION: SelectOption = { label: "Session default", value: UNPINNED };
const BACKEND_DEFAULT_MODEL_OPTION: SelectOption = { label: "Backend default", value: UNPINNED };

/** A blank agent, used as the starting point of every create. */
const EMPTY_DRAFT: AgentEditorDraft = Object.freeze({
  name: "",
  icon: "",
  description: "",
  instructions: "",
  backendId: UNPINNED,
  modelId: UNPINNED,
  memoryEnabled: true,
});

/** Open editor: which agent (none, while creating) and the fields as typed. */
interface EditorState {
  mode: "create" | "edit";
  slug: string | null;
  draft: AgentEditorDraft;
  error: string | null;
  saving: boolean;
}

/**
 * Agents tab container. Owns the roster read from the vault, the open editor,
 * and every write, delegating rendering to {@link AgentsSettingsView} so the
 * panel's states stay renderable from fixtures in the gallery.
 */
export const AgentsSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  // Agents live under the single configurable Copilot root, so the folder is
  // derived rather than configured here; it also keys the reload effect.
  const agentsFolder = deriveAgentsFolder(settings);
  const manager = useMemo(() => new AgentFileManager(app), [app]);

  const [records, setRecords] = useState<readonly AgentRecord[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  // Anchor for Radix portals on this tab (the row overflow menus), keeping them
  // inside Obsidian's Settings modal focus scope.
  const containerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setRecords(await manager.listAgents());
    } catch (error) {
      logError("[Agents] Failed to list agents", error);
    }
  }, [manager]);

  // Refresh on mount, when the Copilot root moves, and whenever this Settings
  // window regains focus: `agent.md` and `MEMORY.md` are ordinary notes the
  // user may have just edited in another window or had changed by sync.
  useEffect(() => {
    void reload();
    const hostWindow = containerRef.current?.win;
    const handleFocus = (): void => void reload();
    hostWindow?.addEventListener("focus", handleFocus);
    return () => hostWindow?.removeEventListener("focus", handleFocus);
  }, [reload, agentsFolder]);

  const descriptors = useMemo(() => listBackendDescriptors(), []);
  const backendOptions = useMemo<SelectOption[]>(
    () => [
      SESSION_BACKEND_OPTION,
      ...descriptors.map(({ id, displayName }) => ({ label: displayName, value: id })),
    ],
    [descriptors]
  );
  const modelOptions = useMemo<SelectOption[]>(() => {
    const descriptor = descriptors.find((entry) => entry.id === editor?.draft.backendId);
    const enabled = descriptor?.getEnabledModelEntries?.(settings) ?? [];
    return [
      BACKEND_DEFAULT_MODEL_OPTION,
      ...enabled.map((entry) => ({
        label: entry.name || entry.baseModelId,
        value: entry.baseModelId,
      })),
    ];
  }, [descriptors, editor?.draft.backendId, settings]);

  const rows = useMemo<AgentRowItem[]>(
    () =>
      records.map(({ agent, memoryBytes }) => ({
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        icon: agent.icon,
        backendLabel:
          descriptors.find((entry) => entry.id === agent.backendId)?.displayName ?? agent.backendId,
        cloudEgress:
          settings.enableSelfHostMode === true &&
          descriptors.find((entry) => entry.id === agent.backendId)?.selfHostable === false,
        memoryLabel: agent.memoryEnabled ? formatMemorySize(memoryBytes) : null,
      })),
    [descriptors, records, settings.enableSelfHostMode]
  );

  const openEditor = useCallback(
    (slug: string) => {
      const record = records.find((entry) => entry.agent.slug === slug);
      if (!record) return;
      const { agent } = record;
      setEditor({
        mode: "edit",
        slug,
        error: null,
        saving: false,
        draft: {
          name: agent.name,
          icon: agent.icon,
          description: agent.description,
          instructions: agent.instructions,
          backendId: agent.backendId ?? UNPINNED,
          modelId: agent.modelId ?? UNPINNED,
          memoryEnabled: agent.memoryEnabled,
        },
      });
    },
    [records]
  );

  /** Close Settings first, or the note opens behind the modal. */
  const openNote = useCallback(
    (path: string) => {
      (app as unknown as { setting: { close: () => void } }).setting.close();
      openVaultPath(app, path, { newLeaf: true });
    },
    [app]
  );

  const handleSave = useCallback(() => {
    if (!editor) return;
    const { draft } = editor;
    // The Save button stays disabled until the name is non-blank, so the only
    // field that can still be wrong here is the icon.
    const name = draft.name.trim();
    if (draft.icon.trim().length > 0 && !isValidAgentIcon(draft.icon)) {
      setEditor({ ...editor, error: "The icon must be a single emoji or letter." });
      return;
    }

    const payload: AgentDraft = {
      name,
      icon: draft.icon.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions,
      backendId: draft.backendId || null,
      modelId: draft.modelId || null,
      memoryEnabled: draft.memoryEnabled,
    };
    setEditor({ ...editor, error: null, saving: true });
    const write =
      editor.slug === null
        ? manager.createAgent(payload)
        : manager.updateAgent(editor.slug, payload);
    void write
      .then(async (record) => {
        await reload();
        setEditor(null);
        new Notice(`Saved ${record.agent.name}.`);
      })
      .catch((error: unknown) => {
        logError("[Agents] Failed to save agent", error);
        setEditor((current) =>
          current === null
            ? null
            : {
                ...current,
                saving: false,
                error: error instanceof Error ? error.message : "Could not save the agent.",
              }
        );
      });
  }, [editor, manager, reload]);

  const handleClearMemory = useCallback(
    (slug: string) => {
      void manager
        .clearMemory(slug)
        .then(reload)
        .catch((error: unknown) => {
          logError("[Agents] Failed to clear memory", error);
          new Notice("Could not clear the memory file.");
        });
    },
    [manager, reload]
  );

  const handleDelete = useCallback(
    (slug: string) => {
      const record = records.find((entry) => entry.agent.slug === slug);
      if (!record) return;
      new AgentDeleteConfirmModal(app, record.agent.name, record.folderPath, async () => {
        try {
          await manager.deleteAgent(slug);
        } catch (error) {
          logError("[Agents] Failed to delete agent", error);
          new Notice(`Could not delete ${record.agent.name}.`);
        }
        setEditor((current) => (current?.slug === slug ? null : current));
        await reload();
      }).open();
    },
    [app, manager, records, reload]
  );

  const editorProps = useMemo<AgentEditorProps | null>(() => {
    if (!editor) return null;
    const record = records.find((entry) => entry.agent.slug === editor.slug);
    return {
      mode: editor.mode,
      slug: editor.slug,
      draft: editor.draft,
      onChange: (patch) =>
        setEditor((current) =>
          current === null ? null : { ...current, draft: { ...current.draft, ...patch } }
        ),
      backendOptions,
      modelOptions,
      error: editor.error,
      saving: editor.saving,
      onSave: handleSave,
      onCancel: () => setEditor(null),
      onOpenInEditor: record ? () => openNote(record.filePath) : undefined,
    };
  }, [backendOptions, editor, handleSave, modelOptions, openNote, records]);

  return (
    <div ref={containerRef}>
      <AgentsSettingsView
        agentsFolder={agentsFolder}
        agents={rows}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onNewAgent={() =>
          setEditor({
            mode: "create",
            slug: null,
            draft: EMPTY_DRAFT,
            error: null,
            saving: false,
          })
        }
        selectedSlug={editor?.slug ?? null}
        editor={editorProps}
        containerRef={containerRef}
        actions={{
          onSelect: openEditor,
          onEdit: openEditor,
          onOpenFolder: (slug) => {
            const record = records.find((entry) => entry.agent.slug === slug);
            if (record) revealFolderInExplorer(app, record.folderPath);
          },
          onOpenMemory: (slug) => {
            const record = records.find((entry) => entry.agent.slug === slug);
            if (record) openNote(record.memoryPath);
          },
          onClearMemory: handleClearMemory,
          onDelete: handleDelete,
        }}
      />
    </div>
  );
};
