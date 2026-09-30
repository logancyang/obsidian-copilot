import { render } from "@testing-library/react";
import React from "react";
import { CloudAgentProvider } from "@/components/chat-components/context/CloudAgentContext";
import { AgentPillContent } from "./AgentPillNode";

let mockSelfHostOn = false;
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => ({ enableSelfHostMode: mockSelfHostOn }),
}));

jest.mock("@/components/ui/SelfHostCloudWarningIcon", () => ({
  SelfHostCloudWarningIcon: () => <span data-testid="cloud-warning" />,
}));

const CLOUD_IDS: ReadonlySet<string> = new Set(["claude", "codex"]);

function renderPill(backendId: string): ReturnType<typeof render> {
  return render(
    <CloudAgentProvider cloudAgentIds={CLOUD_IDS}>
      <AgentPillContent backendId={backendId} label={backendId} />
    </CloudAgentProvider>
  );
}

describe("AgentPillNode", () => {
  describe("AgentPillContent()", () => {
    afterEach(() => {
      mockSelfHostOn = false;
    });

    it("shows no warning when Self-Host Mode is off, even for a cloud agent", () => {
      mockSelfHostOn = false;
      const { queryByTestId } = renderPill("claude");
      expect(queryByTestId("cloud-warning")).toBeNull();
    });

    it("warns on a cloud agent when Self-Host Mode is on", () => {
      mockSelfHostOn = true;
      const { queryByTestId } = renderPill("claude");
      expect(queryByTestId("cloud-warning")).not.toBeNull();
    });

    it("does not warn on a self-hostable agent (opencode) when Self-Host Mode is on", () => {
      mockSelfHostOn = true;
      const { queryByTestId } = renderPill("opencode");
      expect(queryByTestId("cloud-warning")).toBeNull();
    });

    it("does not warn on an unknown backend id (not in the cloud set)", () => {
      mockSelfHostOn = true;
      const { queryByTestId } = renderPill("ghost");
      expect(queryByTestId("cloud-warning")).toBeNull();
    });

    it("lights up a stale pill when Self-Host Mode toggles on (same mounted node)", () => {
      const tree = (): React.ReactElement => (
        <CloudAgentProvider cloudAgentIds={CLOUD_IDS}>
          <AgentPillContent backendId="claude" label="Claude" />
        </CloudAgentProvider>
      );
      mockSelfHostOn = false;
      const { queryByTestId, rerender } = render(tree());
      expect(queryByTestId("cloud-warning")).toBeNull();

      mockSelfHostOn = true;
      rerender(tree());
      expect(queryByTestId("cloud-warning")).not.toBeNull();
    });
  });
});
