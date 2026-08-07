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
      configDialog.unmount();
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
