import { useChatInputAutoFocus } from "@/agentMode/ui/hooks/useChatInputAutoFocus";
import { EVENT_NAMES } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { act, renderHook } from "@testing-library/react";
import React, { useEffect } from "react";

// Stands in for LexicalEditor's FocusPlugin wiring: registers a focus handler
// with the context once mounted, exactly as the real editor does.
function FocusRegistrar({ onFocus }: { onFocus: () => void }) {
  const { registerFocusHandler } = useChatInput();
  useEffect(() => {
    registerFocusHandler(onFocus);
  }, [registerFocusHandler, onFocus]);
  return null;
}

function makeWrapper(focus: () => void, eventTarget?: EventTarget) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <EventTargetContext.Provider value={eventTarget}>
        <ChatInputProvider>
          <FocusRegistrar onFocus={focus} />
          {children}
        </ChatInputProvider>
      </EventTargetContext.Provider>
    );
  };
}

describe("useChatInputAutoFocus", () => {
  it("does not focus on a plain mount (no startup focus steal)", () => {
    const focus = jest.fn();
    const eventTarget = new ChatViewEventTarget();

    renderHook(() => useChatInputAutoFocus(), { wrapper: makeWrapper(focus, eventTarget) });

    expect(focus).not.toHaveBeenCalled();
  });

  it("drains a visibility queued before mount (view opened while still mounting)", () => {
    const focus = jest.fn();
    const eventTarget = new ChatViewEventTarget();
    eventTarget.queueVisible(); // latched before the listener / focus handler exist

    renderHook(() => useChatInputAutoFocus(), { wrapper: makeWrapper(focus, eventTarget) });

    // Drained on attach; the context's focus latch fires once the handler
    // registers — no timer.
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("focuses when visibility is queued after mount (already open)", () => {
    const focus = jest.fn();
    const eventTarget = new ChatViewEventTarget();

    renderHook(() => useChatInputAutoFocus(), { wrapper: makeWrapper(focus, eventTarget) });
    expect(focus).not.toHaveBeenCalled();

    act(() => eventTarget.queueVisible());
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("focuses on a plain CHAT_IS_VISIBLE dispatch (active-leaf-change)", () => {
    const focus = jest.fn();
    const eventTarget = new ChatViewEventTarget();

    renderHook(() => useChatInputAutoFocus(), { wrapper: makeWrapper(focus, eventTarget) });

    act(() => {
      eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
    });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("stops focusing after unmount", () => {
    const focus = jest.fn();
    const eventTarget = new ChatViewEventTarget();

    const { unmount } = renderHook(() => useChatInputAutoFocus(), {
      wrapper: makeWrapper(focus, eventTarget),
    });
    unmount();

    act(() => eventTarget.queueVisible());
    expect(focus).not.toHaveBeenCalled();
  });

  it("is a no-op (does not throw) when no eventTarget is provided", () => {
    expect(() =>
      renderHook(() => useChatInputAutoFocus(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <ChatInputProvider>{children}</ChatInputProvider>
        ),
      })
    ).not.toThrow();
  });
});
