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
    rerender(<Harness {...BASE} signature="sig-b" draftEmpty={false} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
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
    rerender(<Harness {...BASE} signature="sig-b" isLanding={false} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    rerender(<Harness {...BASE} signature="sig-b" isLanding={true} refresh={refresh} />);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("re-seeds on a project switch instead of diffing across projects", async () => {
    const refresh = jest.fn(async () => true);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
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
    const refresh = jest.fn(async () => false);
    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} signature="sig-b" refresh={refresh} />);
    await flush();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("converges to the final signature when it changes again mid-flight", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const refresh = jest.fn(async () => {
      call += 1;
      if (call === 1) await gate;
      return true;
    });

    const { rerender } = render(<Harness {...BASE} refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} signature="sig-b" refresh={refresh} />);
    await flush();
    rerender(<Harness {...BASE} signature="sig-c" refresh={refresh} />);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
