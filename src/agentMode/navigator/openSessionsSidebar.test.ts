import { NavigatorUpsellModal } from "@/agentMode/navigator/ui/NavigatorUpsell";
import { openSessionsSidebar } from "@/agentMode/navigator/openSessionsSidebar";
import { revealSessionsSidebar } from "@/agentMode/navigator/revealSessionsSidebar";
import type CopilotPlugin from "@/main";
import { setSettings } from "@/settings/model";

const mockOpenUpsell = jest.fn();
jest.mock("@/agentMode/navigator/revealSessionsSidebar", () => ({
  revealSessionsSidebar: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/agentMode/navigator/ui/NavigatorUpsell", () => ({
  NavigatorUpsellModal: jest.fn(() => ({ open: mockOpenUpsell })),
}));

function makePlugin(): CopilotPlugin {
  return { app: {} } as unknown as CopilotPlugin;
}

describe("openSessionsSidebar", () => {
  describe("openSessionsSidebar()", () => {
    beforeEach(() => jest.clearAllMocks());

    it("opens the Navigator for a Plus user for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: true });
      const plugin = makePlugin();

      await openSessionsSidebar(plugin);

      expect(revealSessionsSidebar).toHaveBeenCalledWith(plugin);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });

    it("opens the Plus upgrade dialog instead of the Navigator for a user without Plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: false });
      const plugin = makePlugin();

      await openSessionsSidebar(plugin);

      expect(NavigatorUpsellModal).toHaveBeenCalledWith(plugin.app);
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      expect(revealSessionsSidebar).not.toHaveBeenCalled();
    });

    it("opens the Navigator while entitlement is unknown so a Plus user is never shown the dialog for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: undefined });
      const plugin = makePlugin();

      await openSessionsSidebar(plugin);

      expect(revealSessionsSidebar).toHaveBeenCalledWith(plugin);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });
  });
});
