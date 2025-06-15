import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { CustomCommand } from "./type";
import { CustomCommandManager } from "./customCommandManager";
import { EMPTY_COMMAND } from "@/commands/constants";

export const customCommandsStore = createStore();
export const customCommandsAtom = atom<CustomCommand[]>([]);

export function createCommandInStore(title: string) {
  const commands = customCommandsStore.get(customCommandsAtom);
  customCommandsStore.set(customCommandsAtom, [...commands, { ...EMPTY_COMMAND, title }]);
}

export function deleteCommandFromStore(title: string) {
  const commands = customCommandsStore.get(customCommandsAtom);
  customCommandsStore.set(
    customCommandsAtom,
    commands.filter((command) => command.title !== title)
  );
}

export function updateCommandInStore(command: CustomCommand, prevCommandTitle: string) {
  const commands = customCommandsStore.get(customCommandsAtom);
  let updatedCommands: CustomCommand[];
  const prevIndex = prevCommandTitle ? commands.findIndex((c) => c.title === prevCommandTitle) : -1;
  if (prevIndex !== -1) {
    updatedCommands = commands.map((c) => (c.title === prevCommandTitle ? command : c));
  } else {
    // Create a new command
    updatedCommands = [...commands, command];
  }
  customCommandsStore.set(customCommandsAtom, updatedCommands);
}

export interface UseCustomCommandsResult {
  commands: CustomCommand[];
  addCommand: (title: string) => Promise<void>;
  deleteCommand: (command: CustomCommand) => Promise<void>;
  updateCommand: (command: CustomCommand, prevCommandTitle: string) => Promise<void>;
  /** Batch update commands. Note that this method does not handle renames. */
  updateCommands: (commands: CustomCommand[]) => Promise<void>;
}

export function useCustomCommands(): UseCustomCommandsResult {
  const commands = useAtomValue(customCommandsAtom, { store: customCommandsStore });
  const addCommand = async (title: string) => {
    await CustomCommandManager.getInstance().createCommand(title, "");
  };

  const deleteCommand = async (command: CustomCommand) => {
    await CustomCommandManager.getInstance().deleteCommand(command);
  };

  const updateCommand = async (command: CustomCommand, prevCommandTitle: string) => {
    await CustomCommandManager.getInstance().updateCommand(command, prevCommandTitle);
  };

  const updateCommands = async (commands: CustomCommand[]) => {
    await CustomCommandManager.getInstance().updateCommands(commands);
  };

  return {
    commands,
    addCommand,
    updateCommand,
    updateCommands,
    deleteCommand,
  };
}
