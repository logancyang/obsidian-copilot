import { AgentFileManager } from "@/agents/AgentFileManager";
import {
  createAvatarPreviewUrl,
  encodeAgentAvatar,
  revokeAvatarPreviewUrl,
} from "@/agents/agentAvatarImage";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { formatMemorySize } from "@/agents/agentDisplay";
import { openAgentScratchpad } from "@/agents/openAgentScratchpad";
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
import { consumeRequestedAgentPage } from "@/settings/openSettings";
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
  description: "",
  instructions: "",
  backendId: UNPINNED,
  modelId: UNPINNED,
  effort: UNPINNED,
  memoryEnabled: true,
  avatarSrc: null,
});

interface EditorState {
  mode: "create" | "edit";
  slug: string | null;
  draft: AgentEditorDraft;
  avatarChange?: { image: ArrayBuffer | null };
  error: string | null;
  saving: boolean;
}

const NEW_AGENT_EDITOR: EditorState = Object.freeze({
  mode: "create",
  slug: null,
  draft: EMPTY_DRAFT,
  error: null,
  saving: false,
});

function editStateFor({ agent, avatarSrc }: AgentRecord): EditorState {
  return {
    mode: "edit",
    slug: agent.slug,
    error: null,
    saving: false,
    draft: {
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      backendId: agent.backendId ?? UNPINNED,
      modelId: agent.modelId ?? UNPINNED,
      effort: agent.effort ?? UNPINNED,
      memoryEnabled: agent.memoryEnabled,
      avatarSrc,
    },
  };
}

export const AgentsSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const agentsFolder = deriveAgentsFolder(settings);
  const manager = useMemo(() => new AgentFileManager(app), [app]);

  const [records, setRecords] = useState<readonly AgentRecord[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [requestedPage] = useState(consumeRequestedAgentPage);
  const pendingSlugRef = useRef(requestedPage?.kind === "edit" ? requestedPage.slug : null);
  const [editor, setEditor] = useState<EditorState | null>(
    requestedPage?.kind === "create" ? NEW_AGENT_EDITOR : null
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const listed = await manager.listAgents();
      setRecords(listed);
      const pending = pendingSlugRef.current;
      if (pending !== null) {
        pendingSlugRef.current = null;
        const record = listed.find((entry) => entry.agent.slug === pending);
        if (record) setEditor(editStateFor(record));
      }
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
      records.map((record) => ({
        slug: record.agent.slug,
        name: record.agent.name,
        description: record.agent.description,
        avatarSrc: record.avatarSrc,
        backendLabel:
          descriptors.find((entry) => entry.id === record.agent.backendId)?.displayName ??
          record.agent.backendId,
        cloudEgress:
          settings.enableSelfHostMode === true &&
          descriptors.find((entry) => entry.id === record.agent.backendId)?.selfHostable === false,
        memoryLabel: record.agent.memoryEnabled ? formatMemorySize(record.memoryBytes) : null,
      })),
    [descriptors, records, settings.enableSelfHostMode]
  );

  const openEditor = useCallback(
    (slug: string) => {
      const record = records.find((entry) => entry.agent.slug === slug);
      if (record) setEditor(editStateFor(record));
    },
    [records]
  );

  const previewUrlRef = useRef<string | null>(null);
  const setPreviewUrl = useCallback((url: string | null) => {
    if (previewUrlRef.current) revokeAvatarPreviewUrl(previewUrlRef.current);
    previewUrlRef.current = url;
  }, []);
  useEffect(() => () => setPreviewUrl(null), [setPreviewUrl]);
  const closeEditor = useCallback(() => {
    setPreviewUrl(null);
    setEditor(null);
  }, [setPreviewUrl]);

  const handlePickAvatar = useCallback(
    (file: File) => {
      void encodeAgentAvatar(file)
        .then((image) => {
          const url = createAvatarPreviewUrl(image);
          setPreviewUrl(url);
          setEditor((current) =>
            current === null
              ? null
              : {
                  ...current,
                  error: null,
                  avatarChange: { image },
                  draft: { ...current.draft, avatarSrc: url },
                }
          );
        })
        .catch((error: unknown) => {
          logError("[Agents] Failed to read avatar image", error);
          setEditor((current) =>
            current === null ? null : { ...current, error: "Could not read that image." }
          );
        });
    },
    [setPreviewUrl]
  );

  const handleRemoveAvatar = useCallback(() => {
    setPreviewUrl(null);
    setEditor((current) =>
      current === null
        ? null
        : {
            ...current,
            avatarChange: { image: null },
            draft: { ...current.draft, avatarSrc: null },
          }
    );
  }, [setPreviewUrl]);

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
    const existingIcon = records.find((entry) => entry.agent.slug === editor.slug)?.agent.icon;

    const payload: AgentDraft = {
      name,
      icon: existingIcon ?? "",
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
    const { avatarChange } = editor;
    void write
      .then(async (record) => {
        if (avatarChange) await manager.setAvatar(record.agent.slug, avatarChange.image);
        await reload();
        closeEditor();
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
  }, [closeEditor, editor, manager, records, reload]);

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

  const handleOpenScratchpad = useCallback(
    (record: AgentRecord) => {
      openAgentScratchpad(
        app,
        manager.getScratchpadPath(record.agent.slug),
        record.agent.name,
        openNote
      );
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
        if (editor?.slug === slug) closeEditor();
        await reload();
      }).open();
    },
    [app, closeEditor, editor?.slug, manager, records, reload]
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
      onPickAvatar: handlePickAvatar,
      onRemoveAvatar: handleRemoveAvatar,
      onSave: handleSave,
      onCancel: closeEditor,
      onOpenInEditor: record ? () => openNote(record.filePath) : undefined,
      memory: record
        ? {
            sizeLabel: formatMemorySize(record.memoryBytes),
            onOpenScratchpad: () => handleOpenScratchpad(record),
            onOpenMemory: () => openNote(record.memoryPath),
            onOpenTodaysNotes: () => handleOpenTodaysNotes(record.agent.slug),
            onConsolidate: () => handleConsolidate(record.agent.slug),
            onClear: () => handleClearMemory(record.agent.slug),
          }
        : undefined,
      onDelete: record ? () => handleDelete(record.agent.slug) : undefined,
    };
  }, [
    backendOptions,
    closeEditor,
    editor,
    effortOptions,
    handleClearMemory,
    handleConsolidate,
    handleDelete,
    handleOpenScratchpad,
    handleOpenTodaysNotes,
    handlePickAvatar,
    handleRemoveAvatar,
    handleSave,
    modelOptions,
    openNote,
    records,
  ]);

  return (
    <div ref={containerRef}>
      <AgentsSettingsView
        agentsFolder={agentsFolder}
        agents={rows}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onNewAgent={() => setEditor(NEW_AGENT_EDITOR)}
        editor={editorProps}
        containerRef={containerRef}
        actions={{
          onOpen: openEditor,
          onOpenFolder: (slug) => {
            const record = records.find((entry) => entry.agent.slug === slug);
            if (record) revealFolderInExplorer(app, record.folderPath);
          },
          onDelete: handleDelete,
        }}
      />
    </div>
  );
};
