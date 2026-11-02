import { act, renderHook } from "@testing-library/react";
import { CHAT_AGENT_VIEWTYPE, SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { useSessionsSidebarOpen } from "@/agentMode/navigator/hooks/useSessionsSidebarOpen";
import { makeFakeWorkspaceApp } from "@/agentMode/ui/testing/fakeWorkspaceApp";

describe("useSessionsSidebarOpen", () => {
  describe("useSessionsSidebarOpen()", () => {
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

    it("stops listening to layout changes on unmount", () => {
      const fake = makeFakeWorkspaceApp();
      const { unmount } = renderHook(() => useSessionsSidebarOpen(fake.app));
      expect(fake.layoutListenerCount()).toBe(1);

      unmount();

      expect(fake.layoutListenerCount()).toBe(0);
    });
  });
});
