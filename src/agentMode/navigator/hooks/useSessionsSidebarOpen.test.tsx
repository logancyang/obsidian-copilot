import { act, renderHook } from "@testing-library/react";
import { CHAT_AGENT_VIEWTYPE, SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { useSessionsSidebarOpen } from "@/agentMode/navigator/hooks/useSessionsSidebarOpen";
import { makeFakeWorkspaceApp } from "@/agentMode/ui/testing/fakeWorkspaceApp";
import {
  applyLicenseWithPreview,
  setPreviewAccess,
  verifyStoredToken,
} from "@/agentMode/ui/testing/previewAccess";

jest.mock("@/entitlement");

describe("useSessionsSidebarOpen", () => {
  describe("useSessionsSidebarOpen()", () => {
    beforeEach(() => setPreviewAccess("supporter"));
    it("is false while the workspace has no sessions sidebar leaf for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [CHAT_AGENT_VIEWTYPE]: 1 });

      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      expect(result.current).toBe(false);
    });

    it("is true when the view mounts with a sessions sidebar leaf already open for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      expect(result.current).toBe(true);
    });

    it("turns true when a sessions sidebar leaf opens and false when the last one closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const fake = makeFakeWorkspaceApp();
      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));
      expect(result.current).toBe(false);

      act(() => fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 }));
      expect(result.current).toBe(true);

      act(() => fake.setLeaves({}));
      expect(result.current).toBe(false);
    });

    it("stays true while at least one sessions sidebar leaf remains, such as one in a popout window, for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 2 });
      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      act(() => fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 }));

      expect(result.current).toBe(true);
    });

    it("is false for a user without preview access so the tab strip stays visible beside the blocked Navigator for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("plus-without-preview");
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      expect(result.current).toBe(false);
    });

    it("stays true through startup verification so a Supporter's tab strip never flickers for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("unverified");
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });
      const rendered: boolean[] = [];
      const { result } = renderHook(() => {
        const open = useSessionsSidebarOpen(fake.app);
        rendered.push(open);
        return open;
      });

      await act(() => verifyStoredToken(true));

      expect(result.current).toBe(true);
      expect(rendered).not.toContain(false);
    });

    it("follows the user losing and regaining preview access without a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });
      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      await act(() => verifyStoredToken(false));
      expect(result.current).toBe(false);

      await act(() => applyLicenseWithPreview());
      expect(result.current).toBe(true);
    });

    it("stops listening to layout changes on unmount", () => {
      const fake = makeFakeWorkspaceApp();
      const { unmount } = renderHook(() => useSessionsSidebarOpen(fake.app));
      expect(fake.layoutListenerCount()).toBe(1);

      unmount();

      expect(fake.layoutListenerCount()).toBe(0);
    });
  });
});
