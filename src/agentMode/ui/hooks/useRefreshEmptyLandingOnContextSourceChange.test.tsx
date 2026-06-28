import { useRefreshEmptyLandingOnContextSourceChange } from "@/agentMode/ui/hooks/useRefreshEmptyLandingOnContextSourceChange";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { act, render } from "@testing-library/react";
import React from "react";

interface Props {
  activeProjectId: string;
  signature: string | null;
  isLanding: boolean;
  blocking: boolean;
  draftEmpty: boolean;
  refresh: () => Promise<boolean>;
}

/** Drives the hook through a real component so effects + ref updates run as in
 * production. Each render passes the current props verbatim. */
function Harness(props: Props) {
  useRefreshEmptyLandingOnContextSourceChange(props);
  return null;
}

const BASE: Props = {
  activeProjectId: "p1",
  signature: "sig-a",
  isLanding: true,
  blocking: false,
  draftEmpty: true,
  refresh: async () => true,
};

/** Flush the microtasks the hook's then/finally chain schedules. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useRefreshEmptyLandingOnContextSourceChange", () => {
  it("seeds on first sight without refreshing", async () => {
    const refresh = jest.fn(async () => true);
    render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes when the signature changes on an empty landing", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} signature="sig-b" refresh={refresh} />);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on an unchanged signature (re-render churn)", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} refresh={refresh} />);
    rerender(<Harness {...BASE} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("defers while the draft is dirty, then refreshes once it empties", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    // Source changes while the user is typing — no refresh yet.
    rerender(<Harness {...BASE} signature="sig-b" draftEmpty={false} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    // User clears the input — the deferred change is now picked up.
    rerender(<Harness {...BASE} signature="sig-b" draftEmpty={true} refresh={refresh} />);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("defers while blocking, then refreshes once it clears", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} signature="sig-b" blocking={true} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    rerender(<Harness {...BASE} signature="sig-b" blocking={false} refresh={refresh} />);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("accepts the new signature on a conversation without refreshing", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    // Not a landing: accept silently (next New Chat reads fresh config)…
    rerender(<Harness {...BASE} signature="sig-b" isLanding={false} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    // …and because the baseline advanced, returning to a landing at the SAME
    // signature must not retroactively refresh.
    rerender(<Harness {...BASE} signature="sig-b" isLanding={true} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("re-seeds on a project switch instead of diffing across projects", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    // A different project with a different signature is a switch, not an edit.
    rerender(<Harness {...BASE} activeProjectId="p2" signature="sig-z" refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is a no-op for the global scope", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(
      <Harness {...BASE} activeProjectId={GLOBAL_SCOPE} signature={null} refresh={refresh} />
    );
    await flush();
    rerender(
      <Harness {...BASE} activeProjectId={GLOBAL_SCOPE} signature={null} refresh={refresh} />
    );
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not tight-loop when a refresh keeps failing", async () => {
    // A guarded no-op / failure resolves false; the baseline must stay put
    // WITHOUT self-ticking, so it retries only on a real dependency change.
    const refresh = jest.fn(async () => false);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} signature="sig-b" refresh={refresh} />);
    await flush();
    await flush();
    // Exactly one attempt for the one signature change — no self-driven retries.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("converges to the final signature when it changes again mid-flight", async () => {
    // Hold the first refresh open so the single-flight guard is active while a
    // newer edit lands; on settle the hook must catch up to the LATEST signature.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const refresh = jest.fn(async () => {
      call += 1;
      if (call === 1) await gate; // first replace stays in flight
      return true;
    });

    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    // sig-a → sig-b kicks off the first (held) refresh.
    rerender(<Harness {...BASE} signature="sig-b" refresh={refresh} />);
    await flush();
    // While it's in flight, sig-b → sig-c arrives — gated, no second call yet.
    rerender(<Harness {...BASE} signature="sig-c" refresh={refresh} />);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    // Release the first replace; the success tick re-evaluates and, since the
    // live signature is now sig-c (≠ the captured sig-b baseline), refreshes again.
    await act(async () => {
      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
