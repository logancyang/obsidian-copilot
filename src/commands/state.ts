import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { CustomCommand } from "./type";
import { CustomCommandManager } from "./customCommandManager";
import { EMPTY_COMMAND } from "@/commands/constants";

export const customCommandsStore = createStore();
export const customCommandsAtom = atom<CustomCommand[]>([]);

export interface UseCustomCommandsResult {
  commands: CustomCommand[];
  addCommand: (title: string) => Promise<void>;
  deleteCommand: (command: CustomCommand) => Promise<void>;
  updateCommand: (command: CustomCommand, prevCommand: CustomCommand) => Promise<void>;
  /** Batch update commands. Note that this method does not handle renames. */
  updateCommands: (commands: CustomCommand[]) => Promise<void>;
}

export function useCustomCommands(): UseCustomCommandsResult {
  const commands = useAtomValue(customCommandsAtom, { store: customCommandsStore });
  const addCommand = async (title: string) => {
    await CustomCommandManager.getInstance().createCommand(title, "");
    customCommandsStore.set(customCommandsAtom, [...commands, { ...EMPTY_COMMAND, title }]);
  };

  const deleteCommand = async (command: CustomCommand) => {
    await CustomCommandManager.getInstance().deleteCommand(command);
    customCommandsStore.set(
      customCommandsAtom,
      commands.filter((c) => c.title !== command.title)
    );
  };

  const updateCommand = async (command: CustomCommand, prevCommand: CustomCommand) => {
    // Optimistically update atom
    let updatedCommands: CustomCommand[];
    const prevIndex = commands.findIndex((c) => c.title === prevCommand.title);
    if (prevIndex !== -1) {
      if (command.title !== prevCommand.title) {
        // Remove old, add new
        updatedCommands = [...commands];
        updatedCommands.splice(prevIndex, 1, command);
      } else {
        // Update in place
        updatedCommands = commands.map((c) => (c.title === prevCommand.title ? command : c));
      }
    } else {
      // If not found, just add the new command
      updatedCommands = [...commands, command];
    }
    customCommandsStore.set(customCommandsAtom, updatedCommands);
    await CustomCommandManager.getInstance().updateCommand(command, prevCommand);
  };

  const updateCommands = async (newCommands: CustomCommand[]) => {
    customCommandsStore.set(customCommandsAtom, newCommands);
    await CustomCommandManager.getInstance().updateCommands(newCommands);
  };

  return {
    commands,
    addCommand,
    updateCommand,
    updateCommands,
    deleteCommand,
  };
}
