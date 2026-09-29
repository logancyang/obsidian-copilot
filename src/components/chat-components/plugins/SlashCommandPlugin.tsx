import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, TextNode } from "lexical";
import fuzzysort from "fuzzysort";

import { useCustomCommands } from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { sortSlashCommands } from "@/commands/customCommandUtils";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import type { BackendId, Skill } from "@/agentMode";

import { composeSlashMenuItems, type SlashMenuItem } from "./slashMenuItems";

interface SlashCommandOption extends TypeaheadOption {
  item: SlashMenuItem;
}

interface AgentSlashData {
  enabled: boolean;
  skills: Skill[];
  backendIds: ReadonlySet<BackendId> | null;
}

const EMPTY_SKILLS = Object.freeze([]) as unknown as Skill[];
const EMPTY_AGENT_SLASH_DATA: AgentSlashData = Object.freeze({
  enabled: false,
  skills: EMPTY_SKILLS,
  backendIds: null,
});

function useAgentSlashData(): AgentSlashData {
  const [data, setData] = useState<AgentSlashData>(EMPTY_AGENT_SLASH_DATA);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function loadAgentSlashData(): Promise<void> {
      const { getManagedSkills, SkillManager, listBackendDescriptors } =
        await import("@/agentMode");

      const update = () => {
        if (cancelled) return;
        setData({
          enabled: true,
          skills: getManagedSkills(),
          backendIds: new Set(listBackendDescriptors().map((descriptor) => descriptor.id)),
        });
      };

      update();

      if (SkillManager.hasInstance()) {
        unsubscribe = SkillManager.getInstance().subscribeToSkillSetChange(update);
      }
    }

    void loadAgentSlashData().catch((error) => {
      if (!cancelled) {
        logError("Failed to load Agent Mode slash commands.", error);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return data;
}

function useActiveSlashBackend(
  agentModeEnabled: boolean,
  backendIds: ReadonlySet<BackendId> | null
): BackendId | null {
  const settings = useSettingsValue();
  if (!agentModeEnabled) return null;
  const activeBackend = settings.agentMode?.activeBackend;
  if (typeof activeBackend !== "string" || activeBackend.length === 0) return null;
  if (!backendIds?.has(activeBackend)) return null;
  return activeBackend;
}

export function SlashCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const commands = useCustomCommands();
  const agentSlashData = useAgentSlashData();
  const activeBackend = useActiveSlashBackend(agentSlashData.enabled, agentSlashData.backendIds);
  const [currentQuery, setCurrentQuery] = useState("");

  const sortedCommands = useMemo(() => sortSlashCommands(commands), [commands]);

  const allOptions = useMemo<SlashCommandOption[]>(() => {
    const items = composeSlashMenuItems(agentSlashData.skills, sortedCommands, activeBackend);
    return items.map((item) => ({
      key: item.key,
      title: item.name,
      subtitle: item.description || undefined,
      content: item.body,
      item,
    }));
  }, [agentSlashData.skills, sortedCommands, activeBackend]);

  const filteredOptions = useMemo(() => {
    if (!currentQuery) return allOptions;
    const titleResults = fuzzysort.go(currentQuery, allOptions, {
      key: "title",
      threshold: -10000,
    });
    if (titleResults.length > 0) {
      return titleResults.map((result) => result.obj);
    }
    const contentResults = fuzzysort.go(currentQuery, allOptions, {
      key: "content",
      threshold: -10000,
    });
    return contentResults.map((result) => result.obj);
  }, [allOptions, currentQuery]);

  const replaceSlashWithName = useCallback(
    (name: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        if (!(anchorNode instanceof TextNode)) return;
        const textContent = anchorNode.getTextContent();
        const slashIndex = textContent.lastIndexOf("/", anchor.offset);
        if (slashIndex === -1) return;
        const before = textContent.slice(0, slashIndex);
        const after = textContent.slice(anchor.offset);
        const insert = `/${name} `;
        anchorNode.setTextContent(before + insert + after);
        const newOffset = before.length + insert.length;
        anchorNode.select(newOffset, newOffset);
      });
    },
    [editor]
  );

  const handleSelect = useCallback(
    (option: SlashCommandOption) => {
      const item = option.item;
      if (item.kind === "command") {
        void CustomCommandManager.getInstance().recordUsage(item.command);
      }
      replaceSlashWithName(item.name);
    },
    [replaceSlashWithName]
  );

  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "/",
      allowWhitespace: false,
    },
    options: filteredOptions,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
    },
  });

  if (!state.isOpen) return <></>;

  return (
    <TypeaheadMenuPortal
      options={filteredOptions}
      selectedIndex={state.selectedIndex}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      range={state.range}
      query={state.query}
      showPreview={true}
    />
  );
}
