import { AgentFileManager } from "@/agents/AgentFileManager";
import { isValidAgentIcon } from "@/agents/agentFile";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { formatMemorySize } from "@/agents/agentDisplay";
import type { AgentDraft, AgentRecord } from "@/agents/types";
import { AgentClearMemoryConfirmModal } from "@/agents/ui/AgentClearMemoryConfirmModal";
import { AgentDeleteConfirmModal } from "@/agents/ui/AgentDeleteConfirmModal";
import type { AgentEditorDraft, AgentEditorProps } from "@/agents/ui/AgentEditor";
import type { AgentRowItem } from "@/agents/ui/AgentRow";
import { AgentsSettingsView } from "@/agents/ui/AgentsSettingsView";
import { listBackendDescriptors, resolveEffortOptions } from "@/agentMode";
import type { SelectOption } from "@/components/ui/obsidian-native-select";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { logError } from "@/logger";
import { deriveAgentsFolder } from "@/settings/copilotFolder";
import { useSettingsValue } from "@/settings/model";
import { openVaultPath } from "@/utils/openVaultPath";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const UNPINNED = "";
const SESSION_BACKEND_OPTION: SelectOption = { label: "Session default", value: UNPINNED };
const BACKEND_DEFAULT_MODEL_OPTION: SelectOption = { label: "Backend default", value: UNPINNED };
const MODEL_DEFAULT_EFFORT_OPTION: SelectOption = { label: "Model default", value: UNPINNED };

const EMPTY_DRAFT: AgentEditorDraft = Object.freeze({
  name: "",
  icon: "",
  description: "",
  instructions: "",
  backendId: UNPINNED,
  modelId: UNPINNED,
  effort: UNPINNED,
  memoryEnabled: true,
});

interface EditorState {
  mode: "create" | "edit";
  slug: string | null;
  draft: AgentEditorDraft;
  error: string | null;
  saving: boolean;
}

export const AgentsSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const agentsFolder = deriveAgentsFolder(settings);
  const manager = useMemo(() => new AgentFileManager(app), [app]);

  const [records, setRecords] = useState<readonly AgentRecord[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setRecords(await manager.listAgents());
    } catch (error) {
      logError("[Agents] Failed to list agents", error);
    }
  }, [manager]);

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
  const effortOptions = useMemo<SelectOption[]>(() => {
    const backendId = editor?.draft.backendId;
    const modelId = editor?.draft.modelId;
    const manager = plugin.agentSessionManager;
    if (!manager || !backendId || !modelId) return [MODEL_DEFAULT_EFFORT_OPTION];
    return [
      MODEL_DEFAULT_EFFORT_OPTION,
      ...resolveEffortOptions(manager, backendId, modelId).map((option) => ({
        label: option.label,
        value: option.value ?? UNPINNED,
      })),
    ];
  }, [editor?.draft.backendId, editor?.draft.modelId, plugin]);

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
          effort: agent.effort ?? UNPINNED,
          memoryEnabled: agent.memoryEnabled,
        },
      });
    },
    [records]
  );

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
      effort: draft.effort || null,
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
      const record = records.find((entry) => entry.agent.slug === slug);
      if (!record) return;
      new AgentClearMemoryConfirmModal(
        app,
        record.agent.name,
        record.memoryFolderPath,
        async () => {
          try {
            await manager.clearMemory(slug);
          } catch (error) {
            logError("[Agents] Failed to clear memory", error);
            new Notice("Could not clear the memory file.");
          }
          await reload();
        }
      ).open();
    },
    [app, manager, records, reload]
  );

  const handleOpenTodaysNotes = useCallback(
    (slug: string) => {
      const path = manager.getDailyNotePath(slug, formatMemoryEntryDate(new Date()));
      if (!app.vault.getAbstractFileByPath(path)) {
        new Notice("No notes today yet.");
        return;
      }
      openNote(path);
    },
    [app, manager, openNote]
  );

  const handleConsolidate = useCallback(
    (slug: string) => {
      const sessions = plugin.agentSessionManager;
      if (!sessions) return;
      new Notice("Consolidating memory…");
      void sessions
        .consolidateMemoryNow(slug)
        .then(async (outcome) => {
          await reload();
          if (outcome.status === "written") new Notice("Memory consolidated.");
          else if (outcome.status === "skipped" && outcome.reason === "no-new-notes")
            new Notice("Nothing new to fold in.");
          else if (outcome.status === "conflict")
            new Notice("Memory changed while consolidating; kept your version.");
          else new Notice("Could not consolidate the memory file.");
        })
        .catch((error: unknown) => {
          logError("[Agents] Failed to consolidate memory", error);
          new Notice("Could not consolidate the memory file.");
        });
    },
    [plugin, reload]
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
      effortOptions,
      error: editor.error,
      saving: editor.saving,
      onSave: handleSave,
      onCancel: () => setEditor(null),
      onOpenInEditor: record ? () => openNote(record.filePath) : undefined,
    };
  }, [backendOptions, editor, effortOptions, handleSave, modelOptions, openNote, records]);

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
          onOpenTodaysNotes: handleOpenTodaysNotes,
          onConsolidateMemory: handleConsolidate,
          onClearMemory: handleClearMemory,
          onDelete: handleDelete,
        }}
      />
    </div>
  );
};
