import {
  SessionClientContext,
  useHostSlice,
  useSessionSlice,
} from "@/agentMode/ui/hooks/useSessionSlice";
import { fakeSessionClient } from "@/agentMode/ui/testing/fakeSessionClient";
import type { SessionClient } from "@copilot/protocol/client";
import type { PickerCatalog } from "@copilot/protocol/pickerCatalog";
import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";
import { act, renderHook } from "@testing-library/react";
import * as React from "react";

const usage = (usedTokens: number): SessionUsage => ({ usedTokens, updatedAt: 1 });
const PLAN_USAGE: PlanUsage = {
  windows: [{ id: "weekly", label: "Weekly", percent: 4 }],
  updatedAt: 1,
};

const CATALOG: PickerCatalog = { defaultAgent: "claude", agents: [] };
const LATER_CATALOG: PickerCatalog = { defaultAgent: "codex", agents: [] };

function withClient(client: SessionClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <SessionClientContext.Provider value={client}>{children}</SessionClientContext.Provider>;
  };
}

describe("useSessionSlice", () => {
  describe("useSessionSlice()", () => {
    it("returns the chat's slice from the client's replica", () => {
      const fake = fakeSessionClient({ "chat-1": { usage: usage(10), planUsage: PLAN_USAGE } });

      const { result } = renderHook(() => useSessionSlice("chat-1", "planUsage"), {
        wrapper: withClient(fake.client),
      });

      expect(result.current).toEqual(PLAN_USAGE);
    });

    it("returns the chat's slice on its very first render, so nothing paints a missing value first", () => {
      const fake = fakeSessionClient({ "chat-1": { usage: usage(10) } });
      const seen: (SessionUsage | null)[] = [];

      renderHook(
        () => {
          const value = useSessionSlice("chat-1", "usage");
          seen.push(value);
          return value;
        },
        { wrapper: withClient(fake.client) }
      );

      expect(seen[0]).toEqual(usage(10));
      expect(new Set(seen).size).toBe(1);
    });

    it("returns the new chat's slice on the first render after the chat changes", () => {
      const fake = fakeSessionClient({
        "chat-1": { usage: usage(1) },
        "chat-2": { usage: usage(2) },
      });
      const seen: (SessionUsage | null)[] = [];
      const { rerender } = renderHook(
        ({ chat }) => {
          const value = useSessionSlice(chat, "usage");
          seen.push(value);
          return value;
        },
        { initialProps: { chat: "chat-1" }, wrapper: withClient(fake.client) }
      );
      seen.length = 0;

      rerender({ chat: "chat-2" });

      expect(seen.length).toBeGreaterThan(0);
      expect(seen).toEqual(seen.map(() => usage(2)));
    });

    it("returns null for a chat the host holds no value for", () => {
      const fake = fakeSessionClient();

      const { result } = renderHook(() => useSessionSlice("chat-1", "usage"), {
        wrapper: withClient(fake.client),
      });

      expect(result.current).toBeNull();
    });

    it("returns the new value once an op changes the slice", () => {
      const fake = fakeSessionClient({ "chat-1": { usage: usage(10) } });
      const { result } = renderHook(() => useSessionSlice("chat-1", "usage"), {
        wrapper: withClient(fake.client),
      });

      act(() => fake.setState("chat-1", { usage: usage(42) }));

      expect(result.current).toEqual(usage(42));
    });

    it("does not re-render when only another slice of the chat changes", () => {
      const fake = fakeSessionClient({ "chat-1": { usage: usage(10) } });
      let renders = 0;
      renderHook(
        () => {
          renders++;
          return useSessionSlice("chat-1", "usage");
        },
        { wrapper: withClient(fake.client) }
      );
      const rendersBefore = renders;

      act(() => fake.setState("chat-1", { planUsage: PLAN_USAGE }));

      expect(renders).toBe(rendersBefore);
    });

    it("follows a new chat and releases the old one when the chat changes", () => {
      const fake = fakeSessionClient({
        "chat-1": { usage: usage(1) },
        "chat-2": { usage: usage(2) },
      });
      const { result, rerender } = renderHook(({ chat }) => useSessionSlice(chat, "usage"), {
        initialProps: { chat: "chat-1" },
        wrapper: withClient(fake.client),
      });
      expect(result.current).toEqual(usage(1));

      rerender({ chat: "chat-2" });

      expect(result.current).toEqual(usage(2));
      expect(fake.watchedLiveChats()).toEqual(["chat-2"]);
    });

    it("releases the chat when the component unmounts", () => {
      const fake = fakeSessionClient({ "chat-1": { usage: usage(1) } });
      const { unmount } = renderHook(() => useSessionSlice("chat-1", "usage"), {
        wrapper: withClient(fake.client),
      });

      unmount();

      expect(fake.watchedLiveChats()).toEqual([]);
    });

    it("throws when no session client is provided", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => renderHook(() => useSessionSlice("chat-1", "usage"))).toThrow(
        "useSessionSlice needs a SessionClientContext provider above it."
      );
    });
  });

  describe("useHostSlice()", () => {
    it("returns the host's slice on its very first render and follows each op", () => {
      const fake = fakeSessionClient({}, { pickerCatalog: CATALOG });
      const seen: PickerCatalog[] = [];

      renderHook(
        () => {
          const value = useHostSlice("pickerCatalog");
          seen.push(value);
          return value;
        },
        { wrapper: withClient(fake.client) }
      );
      act(() => fake.setHostState({ pickerCatalog: LATER_CATALOG }));

      expect(seen[0]).toEqual(CATALOG);
      expect(seen.at(-1)).toEqual(LATER_CATALOG);
    });

    it("watches the host feed while mounted and releases it on unmount", () => {
      const fake = fakeSessionClient({}, { pickerCatalog: CATALOG });
      const { unmount } = renderHook(() => useHostSlice("pickerCatalog"), {
        wrapper: withClient(fake.client),
      });

      expect(fake.watchesHost()).toBe(true);
      unmount();
      expect(fake.watchesHost()).toBe(false);
    });

    it("throws when no session client is provided", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => renderHook(() => useHostSlice("pickerCatalog"))).toThrow(
        "useHostSlice needs a SessionClientContext provider above it."
      );
    });
  });
});
