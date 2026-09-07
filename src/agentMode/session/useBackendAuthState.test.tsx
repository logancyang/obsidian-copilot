import type { BackendDescriptor } from "@/agentMode/session/types";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import { act, renderHook, waitFor } from "@testing-library/react";

jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useSettingsValue: () => ({}),
}));

const makeDescriptor = (): BackendDescriptor =>
  ({
    id: "claude",
    displayName: "Claude",
    auth: {
      getStatus: jest.fn().mockResolvedValue({ signedIn: false }),
      signIn: jest.fn().mockResolvedValue({ signedIn: true, label: "zero@example.com" }),
    },
  }) as unknown as BackendDescriptor;

describe("useBackendAuthState", () => {
  describe("useBackendAuthState()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 re-probes backend profile changes even without a caller key", async () => {
      const descriptor = makeDescriptor();
      let profile = "first";
      descriptor.auth!.getProbeKey = () => profile;
      const hook = renderHook(() => useBackendAuthState(descriptor));
      await waitFor(() => expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(1));
      profile = "second";
      hook.rerender();
      await waitFor(() => expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(2));
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 keeps canonical backend identity when legacy caller paths change", async () => {
      const descriptor = makeDescriptor();
      descriptor.auth!.getProbeKey = () => "same-profile";
      let finish!: (status: { signedIn: boolean }) => void;
      let signal!: AbortSignal;
      jest.mocked(descriptor.auth!.signIn).mockImplementation((_settings, handlers) => {
        signal = handlers!.signal!;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const hook = renderHook(({ path }) => useBackendAuthState(descriptor, path), {
        initialProps: { path: "uuid-a" },
      });
      await waitFor(() => expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(1));
      act(() => hook.result.current.signIn());
      hook.rerender({ path: "uuid-b" });
      expect(signal.aborted).toBe(false);
      expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(1);
      await act(async () => finish({ signedIn: true }));
    });

    it("publishes completed sign-in status to every consumer of the same backend auth", async () => {
      const descriptor = makeDescriptor();
      let completeOlderProbe!: (status: { signedIn: boolean }) => void;
      let completeCurrentProbe!: (status: { signedIn: boolean }) => void;
      const olderProbe = new Promise<{ signedIn: boolean }>((resolve) => {
        completeOlderProbe = resolve;
      });
      const currentProbe = new Promise<{ signedIn: boolean }>((resolve) => {
        completeCurrentProbe = resolve;
      });
      let completeSignIn!: (status: { signedIn: boolean; label: string }) => void;
      const signIn = new Promise<{ signedIn: boolean; label: string }>((resolve) => {
        completeSignIn = resolve;
      });
      descriptor.auth!.getStatus = jest
        .fn()
        .mockReturnValueOnce(olderProbe)
        .mockReturnValueOnce(currentProbe);
      descriptor.auth!.signIn = jest.fn(() => signIn);
      const statusCard = renderHook(() => useBackendAuthState(descriptor));
      const configDialog = renderHook(() => useBackendAuthState(descriptor));

      await act(async () => {
        completeCurrentProbe({ signedIn: false });
        await currentProbe;
      });
      await waitFor(() => expect(statusCard.result.current.status).toEqual({ signedIn: false }));
      await waitFor(() => expect(configDialog.result.current.status).toEqual({ signedIn: false }));

      act(() => void configDialog.result.current.signIn());
      const signInHandlers = (descriptor.auth!.signIn as jest.Mock).mock.calls[0][1];
      act(() => void signInHandlers.onUrl("https://example.com/sign-in"));
      const lateConsumer = renderHook(() => useBackendAuthState(descriptor, "late-consumer"));
      expect(lateConsumer.result.current.signingIn).toBe(true);
      expect(lateConsumer.result.current.url).toBe("https://example.com/sign-in");
      await act(async () => {
        completeSignIn({ signedIn: true, label: "zero@example.com" });
        await signIn;
      });
      await act(async () => {
        completeOlderProbe({ signedIn: false });
        await olderProbe;
      });

      await waitFor(() =>
        expect(statusCard.result.current.status).toEqual({
          signedIn: true,
          label: "zero@example.com",
        })
      );
      expect(lateConsumer.result.current.status).toEqual({
        signedIn: true,
        label: "zero@example.com",
      });
      expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(2);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 cancels on dialog teardown and ignores a late login result", async () => {
      const descriptor = makeDescriptor();
      let finish!: (status: { signedIn: boolean }) => void;
      descriptor.auth!.signIn = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const hook = renderHook(() => useBackendAuthState(descriptor));
      await waitFor(() => expect(hook.result.current.status?.signedIn).toBe(false));
      act(() => hook.result.current.signIn());
      const handlers = (descriptor.auth!.signIn as jest.Mock).mock.calls[0][1];
      hook.unmount();
      expect(handlers.signal.aborted).toBe(true);
      await act(async () => {
        finish({ signedIn: true });
      });
      const observer = renderHook(() => useBackendAuthState(descriptor));
      await waitFor(() => expect(observer.result.current.status?.signedIn).toBe(false));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 aborts the owned login when the backend changes", async () => {
      const descriptor = makeDescriptor();
      let finish!: (status: { signedIn: boolean }) => void;
      descriptor.auth!.signIn = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const hook = renderHook(({ backend }) => useBackendAuthState(backend), {
        initialProps: { backend: descriptor },
      });
      await waitFor(() => expect(hook.result.current.status?.signedIn).toBe(false));
      act(() => hook.result.current.signIn());
      const handlers = (descriptor.auth!.signIn as jest.Mock).mock.calls[0][1];
      hook.rerender({ backend: { id: "codex", displayName: "Codex" } as BackendDescriptor });
      expect(handlers.signal.aborted).toBe(true);
      await act(async () => {
        finish({ signedIn: true });
      });
      expect(hook.result.current.status).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves another surface's login on observer replacement and supports explicit shared cancellation", async () => {
      const descriptor = makeDescriptor();
      let finish!: (status: { signedIn: boolean }) => void;
      descriptor.auth!.signIn = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const owner = renderHook(() => useBackendAuthState(descriptor));
      const observer = renderHook(({ backend }) => useBackendAuthState(backend), {
        initialProps: { backend: descriptor },
      });
      await waitFor(() => expect(owner.result.current.status?.signedIn).toBe(false));
      act(() => owner.result.current.signIn());
      const handlers = (descriptor.auth!.signIn as jest.Mock).mock.calls[0][1];
      observer.rerender({ backend: { id: "codex", displayName: "Codex" } as BackendDescriptor });
      expect(handlers.signal.aborted).toBe(false);
      observer.rerender({ backend: descriptor });
      act(() => observer.result.current.cancelSignIn());
      expect(handlers.signal.aborted).toBe(true);
      expect(owner.result.current.signingIn).toBe(true);
      await act(async () => {
        finish({ signedIn: true });
      });
      expect(owner.result.current.signingIn).toBe(false);
      expect(owner.result.current.status?.signedIn).toBe(false);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 retains cached status while a newly mounted consumer refreshes it", async () => {
      const descriptor = makeDescriptor();
      const first = renderHook(() => useBackendAuthState(descriptor));
      await waitFor(() => expect(first.result.current.status?.signedIn).toBe(false));
      let finish!: (status: { signedIn: boolean }) => void;
      descriptor.auth!.getStatus = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const second = renderHook(() => useBackendAuthState(descriptor));
      await waitFor(() => expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(1));
      expect(first.result.current.status?.signedIn).toBe(false);
      expect(second.result.current.status?.signedIn).toBe(false);
      await act(async () => {
        finish({ signedIn: true });
      });
      expect(first.result.current.status?.signedIn).toBe(true);
      expect(second.result.current.status?.signedIn).toBe(true);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 clears a previous profile's failure before probing its replacement", async () => {
      const descriptor = makeDescriptor();
      descriptor.auth!.signIn = jest.fn().mockResolvedValue({ signedIn: false });
      const hook = renderHook(({ profile }) => useBackendAuthState(descriptor, profile), {
        initialProps: { profile: "first" },
      });
      await waitFor(() => expect(hook.result.current.status?.signedIn).toBe(false));
      await act(async () => {
        hook.result.current.signIn();
      });
      expect(hook.result.current.failed).toBe(true);
      hook.rerender({ profile: "second" });
      expect(hook.result.current.failed).toBe(false);
      await waitFor(() => expect(hook.result.current.status?.signedIn).toBe(false));
      expect(hook.result.current.failed).toBe(false);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 waits for profile cancellation before probing or starting another login", async () => {
      const descriptor = makeDescriptor();
      let finish!: (status: { signedIn: boolean }) => void;
      descriptor.auth!.signIn = jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const hook = renderHook(({ profile }) => useBackendAuthState(descriptor, profile), {
        initialProps: { profile: "first" },
      });
      await waitFor(() => expect(hook.result.current.status?.signedIn).toBe(false));
      act(() => hook.result.current.signIn());
      const handlers = (descriptor.auth!.signIn as jest.Mock).mock.calls[0][1];
      act(() => {
        handlers.onUrl("https://example.com/login");
      });
      hook.rerender({ profile: "second" });
      expect(handlers.signal.aborted).toBe(true);
      expect(hook.result.current.signingIn).toBe(true);
      expect(hook.result.current.status).toBeNull();
      expect(hook.result.current.url).toBeNull();
      act(() => hook.result.current.signIn());
      await act(async () => {});
      expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(1);
      expect(descriptor.auth!.signIn).toHaveBeenCalledTimes(1);
      await act(async () => {
        finish({ signedIn: true });
      });
      expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(2);
      expect(hook.result.current.status?.signedIn).toBe(false);
      expect(hook.result.current.signingIn).toBe(false);
      expect(hook.result.current.failed).toBe(false);
      act(() => hook.result.current.signIn());
      expect(descriptor.auth!.signIn).toHaveBeenCalledTimes(2);
      await act(async () => {
        finish({ signedIn: true });
      });
    });

    it("re-probes when the caller's auth-relevant key changes", async () => {
      const descriptor = makeDescriptor();
      descriptor.auth!.getStatus = jest
        .fn()
        .mockResolvedValueOnce({ signedIn: false })
        .mockResolvedValueOnce({ signedIn: true });
      const { result, rerender } = renderHook(
        ({ binaryPath }) => useBackendAuthState(descriptor, binaryPath),
        { initialProps: { binaryPath: "" } }
      );

      await waitFor(() => expect(result.current.status).toEqual({ signedIn: false }));

      rerender({ binaryPath: "/usr/local/bin/claude" });

      await waitFor(() => expect(result.current.status).toEqual({ signedIn: true }));
      expect(descriptor.auth!.getStatus).toHaveBeenCalledTimes(2);
    });

    it("keeps auth state empty when the descriptor has no auth capability", () => {
      const descriptor = { id: "codex", displayName: "Codex" } as BackendDescriptor;

      const { result } = renderHook(() => useBackendAuthState(descriptor));

      expect(result.current.status).toBeNull();
      expect(result.current.signingIn).toBe(false);
      expect(result.current.url).toBeNull();
    });
  });
});
