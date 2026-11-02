import { NavigatorUpsellModal } from "@/agentMode/ui/NavigatorUpsell";
import {
  openNavigatorWhenPreviewActivates,
  openSessionsSidebar,
} from "@/agentMode/ui/openSessionsSidebar";
import {
  applyLicenseWithPreview,
  verifyStoredToken,
  setPreviewAccess,
} from "@/agentMode/ui/testing/previewAccess";
import type CopilotPlugin from "@/main";
import { setSettings } from "@/settings/model";

jest.mock("@/entitlement");

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

  describe("openNavigatorWhenPreviewActivates()", () => {
    it("opens the Navigator once when a license key with preview is applied after a prompt for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("plus-without-preview");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPreviewActivates(plugin);
      await applyLicenseWithPreview();
      await verifyStoredToken(false);
      await applyLicenseWithPreview();

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens the Navigator when verifying the stored token grants preview without any settings write for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("plus-without-preview");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPreviewActivates(plugin);
      await verifyStoredToken(true);

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("keeps waiting through settings changes and verifications that do not grant preview for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("plus-without-preview");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPreviewActivates(plugin);
      setSettings({ isPaidUser: true });
      await verifyStoredToken(false);

      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      await applyLicenseWithPreview();
      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("opens a single Navigator when several prompts were shown before preview activates for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("free");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPreviewActivates(plugin);
      openNavigatorWhenPreviewActivates(plugin);
      await applyLicenseWithPreview();

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });

    it("stops waiting once the plugin unloads for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("free");
      const { plugin, unload } = makePlugin();

      openNavigatorWhenPreviewActivates(plugin);
      unload();
      await applyLicenseWithPreview();

      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
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
      { who: "a Plus user without preview", access: "plus-without-preview", opens: "the dialog" },
      { who: "a free user", access: "free", opens: "the dialog" },
    ] as const)(
      "opens $opens for $who for https://github.com/Brevilabs/obsidian-copilot-private/issues/819",
      async ({ access, opens }) => {
        await setPreviewAccess(access);
        const { plugin, unload } = makePlugin();

        await openSessionsSidebar(plugin);

        const opensNavigator = opens === "the Navigator";
        expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(opensNavigator ? 1 : 0);
        expect(jest.mocked(NavigatorUpsellModal).mock.calls).toEqual(
          opensNavigator ? [] : [[plugin.app]]
        );
        expect(mockOpenUpsell).toHaveBeenCalledTimes(opensNavigator ? 0 : 1);
        unload();
      }
    );

    it("opens the Navigator when preview becomes active after the dialog was shown for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("free");
      const { plugin, unload } = makePlugin();

      await openSessionsSidebar(plugin);
      await applyLicenseWithPreview();

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      unload();
    });
  });
});
