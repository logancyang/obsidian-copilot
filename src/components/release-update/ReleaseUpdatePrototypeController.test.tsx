import { registerReleaseUpdatePrototypeCommandsForDevelopment } from "@/components/release-update/ReleaseUpdatePrototypeController";
import {
  getAgentHomeReleaseUpdatePrototype,
  setAgentHomeReleaseUpdatePrototype,
} from "@/components/release-update/agentHomeReleaseUpdatePrototypeStore";
import type { Plugin } from "obsidian";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";

interface RegisteredCommand {
  callback: () => void;
  id: string;
  name: string;
}

function createFakePlugin(version = "4.0.3+dev.prototype") {
  const commands: RegisteredCommand[] = [];
  const cleanups: Array<() => void> = [];
  const plugin = {
    addCommand: jest.fn((command: RegisteredCommand) => commands.push(command)),
    manifest: { version },
    register: jest.fn((cleanup: () => void) => cleanups.push(cleanup)),
  } as unknown as Plugin;

  return { cleanups, commands, plugin };
}

describe("ReleaseUpdatePrototypeController", () => {
  beforeEach(() => setAgentHomeReleaseUpdatePrototype(false));

  describe("registerReleaseUpdatePrototypeCommandsForDevelopment()", () => {
    it(`registers only the selected Agent Home preview for test-vault builds in ${ISSUE_URL}`, () => {
      const { cleanups, commands, plugin } = createFakePlugin();

      registerReleaseUpdatePrototypeCommandsForDevelopment(plugin);

      expect(commands.map((command) => command.id)).toEqual([
        "prototype-agent-home-release-update-bottom-banner",
      ]);
      commands[0].callback();
      expect(getAgentHomeReleaseUpdatePrototype()).toBe(true);
      cleanups[0]();
      expect(getAgentHomeReleaseUpdatePrototype()).toBe(false);
    });

    it(`keeps the temporary command out of production manifests for ${ISSUE_URL}`, () => {
      const { commands, plugin } = createFakePlugin("4.0.3");

      registerReleaseUpdatePrototypeCommandsForDevelopment(plugin);

      expect(commands).toEqual([]);
      expect(plugin.register).not.toHaveBeenCalled();
    });
  });
});
