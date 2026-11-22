import {
  openNavigatorWhenUnlocked,
  openSessionsSidebar,
} from "@/agentMode/navigator/openSessionsSidebar";
import { revealSessionsSidebar } from "@/agentMode/navigator/revealSessionsSidebar";
import { NavigatorUpsellModal } from "@/agentMode/navigator/ui/NavigatorUpsell";
import {
  applyLicenseWithNavigator,
  verifyStoredToken,
  setNavigatorAccess,
} from "@/agentMode/ui/testing/navigatorAccess";
import type CopilotPlugin from "@/main";
import { setSettings } from "@/settings/model";

jest.mock("@/entitlement");

const mockValidateLicenseKey = jest.fn<Promise<unknown>, [unknown, Record<string, unknown>]>(
  async () => ({ isValid: undefined })
);
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (app: unknown, context: Record<string, unknown>) =>
        mockValidateLicenseKey(app, context),
    }),
  },
}));

const mockOpenUpsell = jest.fn();
jest.mock("@/agentMode/navigator/revealSessionsSidebar", () => ({
  revealSessionsSidebar: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/agentMode/navigator/ui/NavigatorUpsell", () => ({
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
    register: jest.fn((cleanup: () => void) => cleanups.push(cleanup)),
  } as unknown as CopilotPlugin;
  return { plugin, unload: () => cleanups.forEach((cleanup) => cleanup()) };
}

describe("openSessionsSidebar", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("openNavigatorWhenUnlocked()", () => {
    it("opens the Navigator once when a license key with Navigator access is applied after a prompt for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("plus-without-navigator");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenUnlocked(plugin);
      await applyLicenseWithNavigator();
      await verifyStoredToken(false);
      await applyLicenseWithNavigator();

      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens the Navigator when verifying the stored token grants the Navigator without any settings write for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("plus-without-navigator");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenUnlocked(plugin);
      await verifyStoredToken(true);

      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("keeps waiting through settings changes and verifications that do not grant the Navigator for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("plus-without-navigator");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenUnlocked(plugin);
      setSettings({ isPaidUser: true });
      await verifyStoredToken(false);

      expect(revealSessionsSidebar).not.toHaveBeenCalled();
      await applyLicenseWithNavigator();
      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens a single Navigator when several prompts were shown before Navigator access activates for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("free");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenUnlocked(plugin);
      openNavigatorWhenUnlocked(plugin);
      await applyLicenseWithNavigator();

      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("stops waiting once the plugin unloads for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("free");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenUnlocked(plugin);
      unload();
      await applyLicenseWithNavigator();

      expect(revealSessionsSidebar).not.toHaveBeenCalled();
    });
  });

  describe("openSessionsSidebar()", () => {
    it.each([
      { who: "a Supporter", access: "supporter", opens: "the Navigator" },
      {
        who: "a user whose stored entitlement is still being verified at startup",
        access: "unverified",
        opens: "the Navigator",
      },
      {
        who: "a Plus user without Navigator access",
        access: "plus-without-navigator",
        opens: "the dialog",
      },
      { who: "a free user", access: "free", opens: "the dialog" },
    ] as const)(
      "opens $opens for $who for https://github.com/Brevilabs/obsidian-copilot-private/issues/819",
      async ({ access, opens }) => {
        await setNavigatorAccess(access);
        const { plugin, unload } = makePlugin();

        await openSessionsSidebar(plugin);

        const opensNavigator = opens === "the Navigator";
        expect(revealSessionsSidebar).toHaveBeenCalledTimes(opensNavigator ? 1 : 0);
        expect(jest.mocked(NavigatorUpsellModal).mock.calls).toEqual(
          opensNavigator ? [] : [[plugin.app]]
        );
        expect(mockOpenUpsell).toHaveBeenCalledTimes(opensNavigator ? 0 : 1);
        unload();
      }
    );

    it("opens the Navigator for a Supporter without waiting for its background license check, reporting the navigator trigger, for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      await setNavigatorAccess("supporter");
      mockValidateLicenseKey.mockImplementationOnce(() => new Promise(() => {}));
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);

      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      expect(mockValidateLicenseKey).toHaveBeenCalledWith(plugin.app, { trigger: "navigator" });
      unload();
    });

    it("opens the Navigator without the dialog when the license check renews a stored token that lacked Navigator access for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      await setNavigatorAccess("plus-without-navigator");
      mockValidateLicenseKey.mockImplementationOnce(async () => {
        await applyLicenseWithNavigator();
        return { isValid: true };
      });
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);

      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
      unload();
    });

    it("opens the dialog when the license check for a token without Navigator access cannot reach the server for https://github.com/Brevilabs/obsidian-copilot-private/issues/834", async () => {
      await setNavigatorAccess("plus-without-navigator");
      mockValidateLicenseKey.mockRejectedValueOnce(new Error("offline"));
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);

      expect(revealSessionsSidebar).not.toHaveBeenCalled();
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens the Navigator when Navigator access becomes active after the dialog was shown for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("free");
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);
      await applyLicenseWithNavigator();

      expect(revealSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });
  });
});
