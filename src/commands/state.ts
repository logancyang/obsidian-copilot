import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { CustomCommand } from "./type";

const customCommandsStore = createStore();
const customCommandsAtom = atom<CustomCommand[]>([]);

export function createCachedCommand(command: CustomCommand): CustomCommand {
  const commands = customCommandsStore.get(customCommandsAtom);
  const existingCommand = commands.find((c) => c.title === command.title);
  if (existingCommand) {
    return existingCommand;
  }
  customCommandsStore.set(customCommandsAtom, [...commands, command]);
  return command;
}

export function deleteCachedCommand(title: string) {
  const commands = customCommandsStore.get(customCommandsAtom);
  customCommandsStore.set(
    customCommandsAtom,
    commands.filter((command) => command.title !== title)
  );
}

export function updateCachedCommand(command: CustomCommand, prevCommandTitle: string) {
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

export function updateCachedCommands(commands: CustomCommand[]) {
  customCommandsStore.set(customCommandsAtom, commands);
}

export function useCustomCommands(): CustomCommand[] {
  return useAtomValue(customCommandsAtom, { store: customCommandsStore });
}

export function getCachedCustomCommands(): CustomCommand[] {
  return customCommandsStore.get(customCommandsAtom);
}
