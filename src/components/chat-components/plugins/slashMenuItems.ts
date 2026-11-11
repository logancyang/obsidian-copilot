import fuzzysort from "fuzzysort";
import { $getSelection, $isRangeSelection, $isRootNode, type LexicalNode } from "lexical";
import React from "react";
import type { BackendId, ReadOnlySkill, Skill } from "@/agentMode";
import { Badge } from "@/components/ui/badge";
import { COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import type { CustomCommand } from "@/commands/type";

export type SlashMenuSource = "Built-in" | "Vault" | "Computer" | "Command";

export type SlashMenuItem =
  | {
      kind: "builtin";
      key: string;
      name: string;
      description: string;
      body: string;
    }
  | {
      kind: "skill";
      key: string;
      name: string;
      description: string;
      body: string;
      source: SlashMenuSource;
      skill: Skill | ReadOnlySkill;
    }
  | {
      kind: "command";
      key: string;
      name: string;
      description: string;
      body: string;
      source: "Command";
      command: CustomCommand;
    };

const NO_READ_ONLY_SKILLS: ReadonlyArray<ReadOnlySkill> = Object.freeze([]);

const COMPACT_ITEM: SlashMenuItem = {
  kind: "builtin",
  key: `builtin:${COMPACT_COMMAND_NAME}`,
  name: COMPACT_COMMAND_NAME,
  description: "Summarize this chat to free up context",
  body: "",
};

export function composeSlashMenuItems(
  skills: Skill[],
  commands: CustomCommand[],
  activeBackend: BackendId | null,
  isAgentMode = false,
  readOnlySkills: ReadonlyArray<ReadOnlySkill> = NO_READ_ONLY_SKILLS
): SlashMenuItem[] {
  // The send path treats exactly /compact as the built-in, so only that exact name is shadowed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
  const isBuiltinName = (name: string) => isAgentMode && name === COMPACT_COMMAND_NAME;

  const visibleSkills = skills.filter((skill) => {
    if (skill.userInvocable === false) return false;
    if (isBuiltinName(skill.name)) return false;
    if (activeBackend === null) return true;
    return skill.enabledAgents.includes(activeBackend);
  });

  const skillNames = new Set(visibleSkills.map((s) => s.name.toLowerCase()));

  // Agents run skills from their own folders that Copilot does not manage, so the menu offers them
  // too, behind any vault skill of the same name. https://github.com/logancyang/obsidian-copilot/issues/3659
  const vaultFirst = (skill: ReadOnlySkill) => (skill.scope === "vault" ? 0 : 1);
  const visibleReadOnlySkills = [...readOnlySkills]
    .sort((a, b) => vaultFirst(a) - vaultFirst(b))
    .filter((skill) => {
      if (skill.userInvocable === false || isBuiltinName(skill.name)) return false;
      if (activeBackend !== null && !skill.agents.includes(activeBackend)) return false;
      const key = skill.name.toLowerCase();
      if (skillNames.has(key)) return false;
      skillNames.add(key);
      return true;
    });

  const visibleCommands = commands.filter((cmd) => {
    if (!cmd.showInSlashMenu) return false;
    return !skillNames.has(cmd.title.toLowerCase()) && !isBuiltinName(cmd.title);
  });

  return [
    ...(isAgentMode ? [COMPACT_ITEM] : []),
    ...visibleSkills.map<SlashMenuItem>((skill, index) => ({
      kind: "skill",
      key: `skill:${skill.name}:${index}`,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      source: skill.builtin ? "Built-in" : "Vault",
      skill,
    })),
    ...visibleReadOnlySkills.map<SlashMenuItem>((skill, index) => ({
      kind: "skill",
      key: `skill:${skill.scope}:${skill.name}:${index}`,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      source: skill.scope === "vault" ? "Vault" : "Computer",
      skill,
    })),
    ...visibleCommands.map<SlashMenuItem>((command, index) => ({
      kind: "command",
      key: `command:${command.title}:${index}`,
      name: command.title,
      description: "",
      body: command.content,
      source: "Command",
      command,
    })),
  ];
}

export function slashMenuOption(item: SlashMenuItem): {
  key: string;
  title: string;
  subtitle?: string;
  content: string;
  trailingContent?: React.ReactNode;
  item: SlashMenuItem;
} {
  return {
    key: item.key,
    title: item.name,
    subtitle: item.description || undefined,
    content: item.body,
    trailingContent:
      item.kind === "builtin"
        ? undefined
        : React.createElement(
            Badge,
            { variant: "outline", className: "tw-shrink-0 tw-px-1.5 tw-py-0 tw-text-faint" },
            item.source
          ),
    item,
  };
}

export function filterSlashMenuOptions<T extends { title: string; content?: string }>(
  options: T[],
  query: string
): T[] {
  if (!query) return options;
  const titleResults = fuzzysort.go(query, options, { key: "title", threshold: -10000 });
  if (titleResults.length > 0) return titleResults.map((result) => result.obj);
  return fuzzysort
    .go(query, options, { key: "content", threshold: -10000 })
    .map((result) => result.obj);
}

// Agents only compact when /compact is the whole prompt, so the built-in is offered only there.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/634
export function $slashStartsPrompt(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const anchorNode = selection.anchor.getNode();
  const text = anchorNode.getTextContent();
  const slashIndex = text.lastIndexOf("/", selection.anchor.offset);
  if (slashIndex === -1 || text.slice(0, slashIndex).trim()) return false;
  for (let node: LexicalNode | null = anchorNode; node && !$isRootNode(node); ) {
    if (node.getPreviousSiblings().some((sibling) => sibling.getTextContent().trim())) return false;
    node = node.getParent();
  }
  return true;
}
