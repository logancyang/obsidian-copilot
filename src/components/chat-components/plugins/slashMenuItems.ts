import type { BackendId, Skill } from "@/agentMode";
import type { CustomCommand } from "@/commands/type";

export type SlashMenuItem =
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

export function composeSlashMenuItems(
  skills: Skill[],
  commands: CustomCommand[],
  activeBackend: BackendId | null
): SlashMenuItem[] {
  const visibleSkills = skills.filter((skill) => {
    if (skill.userInvocable === false) return false;
    if (activeBackend === null) return true;
    return skill.enabledAgents.includes(activeBackend);
  });

  const skillNames = new Set(visibleSkills.map((s) => s.name.toLowerCase()));

  const visibleCommands = commands.filter((cmd) => {
    if (!cmd.showInSlashMenu) return false;
    return !skillNames.has(cmd.title.toLowerCase());
  });

  return [
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
