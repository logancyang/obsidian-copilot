import fuzzysort from "fuzzysort";
import type { BackendId, Skill } from "@/agentMode";
import { COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import type { CustomCommand } from "@/commands/type";

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
      skill: Skill;
    }
  | {
      kind: "command";
      key: string;
      name: string;
      description: string;
      body: string;
      command: CustomCommand;
    };

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
  isAgentMode = false
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
      skill,
    })),
    ...visibleCommands.map<SlashMenuItem>((command, index) => ({
      kind: "command",
      key: `command:${command.title}:${index}`,
      name: command.title,
      description: "",
      body: command.content,
      command,
    })),
  ];
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
