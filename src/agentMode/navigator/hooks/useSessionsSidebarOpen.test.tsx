import { act, renderHook } from "@testing-library/react";
import { CHAT_AGENT_VIEWTYPE, SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { useSessionsSidebarOpen } from "@/agentMode/navigator/hooks/useSessionsSidebarOpen";
import { makeFakeWorkspaceApp } from "@/agentMode/ui/testing/fakeWorkspaceApp";
import { setSettings } from "@/settings/model";

describe("useSessionsSidebarOpen", () => {
  describe("useSessionsSidebarOpen()", () => {
    beforeEach(() => setSettings({ isPaidUser: true }));
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

    it("is false for a user without Plus so the tab strip stays visible beside the blocked Navigator for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      setSettings({ isPaidUser: false });
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      expect(result.current).toBe(false);
    });

    it("stays true while entitlement is unknown so a Plus user's tab strip does not flash for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      setSettings({ isPaidUser: undefined });
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      expect(result.current).toBe(true);
    });

    it("follows the user losing and regaining Plus without a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      const fake = makeFakeWorkspaceApp();
      fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });
      const { result } = renderHook(() => useSessionsSidebarOpen(fake.app));

      act(() => setSettings({ isPaidUser: false }));
      expect(result.current).toBe(false);

      act(() => setSettings({ isPaidUser: true }));
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
