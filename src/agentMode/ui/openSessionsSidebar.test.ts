import { NavigatorUpsellModal } from "@/agentMode/ui/NavigatorUpsell";
import {
  openNavigatorWhenPlusActivates,
  openSessionsSidebar,
} from "@/agentMode/ui/openSessionsSidebar";
import type CopilotPlugin from "@/main";
import { setSettings } from "@/settings/model";

const mockOpenUpsell = jest.fn();
jest.mock("@/agentMode/ui/NavigatorUpsell", () => ({
  NavigatorUpsellModal: jest.fn(() => ({ open: mockOpenUpsell })),
}));

interface TestPlugin {
  plugin: CopilotPlugin;
  unload: () => void;
}

function makePlugin(): TestPlugin {
  const cleanups: Array<() => void> = [];
  const plugin = {
    app: {},
    activateSessionsSidebar: jest.fn().mockResolvedValue(undefined),
    register: jest.fn((cleanup: () => void) => cleanups.push(cleanup)),
  } as unknown as CopilotPlugin;
  return { plugin, unload: () => cleanups.forEach((cleanup) => cleanup()) };
}

describe("openSessionsSidebar", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("openNavigatorWhenPlusActivates()", () => {
    it("opens the Navigator once when Plus becomes active after a prompt for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      setSettings({ isPaidUser: false });
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPlusActivates(plugin);
      setSettings({ isPaidUser: true });
      setSettings({ isPaidUser: false });
      setSettings({ isPaidUser: true });

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("keeps waiting through settings changes that do not activate Plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      setSettings({ isPaidUser: false });
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPlusActivates(plugin);
      setSettings({ plusLicenseKey: "typed-but-not-applied" });
      setSettings({ isPaidUser: undefined });

      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      setSettings({ isPaidUser: true });
      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens a single Navigator when several prompts were shown before Plus activates for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      setSettings({ isPaidUser: false });
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPlusActivates(plugin);
      openNavigatorWhenPlusActivates(plugin);
      setSettings({ isPaidUser: true });

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("stops waiting once the plugin unloads for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", () => {
      setSettings({ isPaidUser: false });
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPlusActivates(plugin);
      unload();
      setSettings({ isPaidUser: true });

      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
    });
  });

  describe("openSessionsSidebar()", () => {
    it("opens the Navigator for a Plus user for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: true });
      const { plugin } = makePlugin();

      await openSessionsSidebar(plugin);

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
      expect(plugin.register).not.toHaveBeenCalled();
    });

    it("opens the Plus upgrade dialog instead of the Navigator for a user without Plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: false });
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);

      expect(NavigatorUpsellModal).toHaveBeenCalledWith(plugin.app);
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      unload();
    });

    it("opens the Navigator when Plus becomes active after the upgrade dialog was shown for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      setSettings({ isPaidUser: false });
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);
      setSettings({ isPaidUser: true });

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens the Navigator while entitlement is unknown so a Plus user is never shown the dialog for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: undefined });
      const { plugin } = makePlugin();

      await openSessionsSidebar(plugin);

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });
  });
});
