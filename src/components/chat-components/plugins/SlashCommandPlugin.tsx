import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, TextNode } from "lexical";
import fuzzysort from "fuzzysort";
import { Platform } from "obsidian";

import { useCustomCommands } from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { sortSlashCommands } from "@/commands/customCommandUtils";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
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
    if (!Platform.isDesktopApp) return;

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

/**
 * Resolve the active backend id for slash-menu filtering. Returns `null`
 * when Agent Mode is disabled, or when `activeBackend` is unset/unknown —
 * either case routes through the plain-LLM fallback (show every visible
 * skill) rather than silently filtering everything out, which is the
 * behaviour a typoed or stale setting would otherwise produce.
 */
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

/**
 * Slash command plugin.
 *
 * Surfaces a unified slash menu containing managed skills (filtered to
 * those enabled for the active backend, or all visible skills when no
 * backend is configured) plus legacy custom commands. Managed skills win
 * on name collision.
 *
 * Selection rewrites the typed `/<query>` in the editor to a literal
 * `/<name> ` (trailing space) and leaves focus in the composer. The user
 * may then append args and press Enter to send. We deliberately do not
 * auto-submit so the user can review / adjust the invocation first.
 */
export function SlashCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const commands = useCustomCommands();
  const agentSlashData = useAgentSlashData();
  const activeBackend = useActiveSlashBackend(agentSlashData.enabled, agentSlashData.backendIds);
  const [currentQuery, setCurrentQuery] = useState("");

  // Recency / strategy sort happens before composition so the slash plugin
  // sees commands in the order the settings request.
  const sortedCommands = useMemo(() => sortSlashCommands(commands), [commands]);

  const allOptions = useMemo<SlashCommandOption[]>(() => {
    const items = composeSlashMenuItems(agentSlashData.skills, sortedCommands, activeBackend);
    return items.map((item) => ({
      key: item.key,
      title: item.name,
      subtitle: item.description || undefined,
      // Body is what would actually run in the fallback path; surfacing it
      // here keeps the preview pane informative.
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

  /**
   * Rewrite the `/<query>` trigger in the editor to a literal `/<name> `
   * (trailing space) and move the caret to the end of the inserted text.
   * The chat composer keeps focus so the user can append args and press
   * Enter to send. Picking does not auto-submit.
   *
   * **Constraint:** assumes the slash and the query live in a single
   * `TextNode`. The typeahead trigger config rejects whitespace inside the
   * query (`allowWhitespace: false` below), and Lexical doesn't split a
   * contiguous typed run across nodes, so that invariant holds for every
   * code path that reaches us today. If it ever breaks (e.g. paste
   * mid-query), the early returns make this a silent no-op rather than a
   * crash — the user can re-trigger by typing `/` again.
   */
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

  // Use the shared typeahead hook. `allowWhitespace: false` makes any space
  // after the `/` close the menu — which is exactly what we want once a
  // selection inserts `/<name> ` (trailing space). It also matches the
  // insert-only behaviour: args are typed after the trailing space, by
  // which point the typeahead is dismissed and the user is in plain
  // editing mode.
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
