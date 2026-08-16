import {
  LegacyChatDeprecationHint,
  type LegacyChatDeprecationHintProps,
} from "@/components/chat-components/ui/LegacyChatDeprecationHint";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let mockDesktopRuntime = true;

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: () => mockDesktopRuntime,
}));

const COPY = "V3 Chat is retiring soon. Use opencode for BYOK and Copilot-hosted models.";

describe("LegacyChatDeprecationHint", () => {
  describe("LegacyChatDeprecationHint()", () => {
    beforeEach(() => {
      mockDesktopRuntime = true;
    });

    it("shows deprecation guidance with an alert icon and opens Agent when selected", () => {
      const onOpenAgent = jest.fn();
      const props: LegacyChatDeprecationHintProps = { onOpenAgent };

      const { container } = render(<LegacyChatDeprecationHint {...props} />);

      expect(container.querySelector(".lucide-circle-alert")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: COPY }));

      expect(onOpenAgent).toHaveBeenCalledTimes(1);
    });

    it("hides the Agent migration hint on mobile because Agent is unavailable (https://github.com/logancyang/obsidian-copilot-preview/issues/323)", () => {
      mockDesktopRuntime = false;

      render(<LegacyChatDeprecationHint onOpenAgent={jest.fn()} />);

      expect(screen.queryByRole("button", { name: COPY })).toBeNull();
    });
  });
});
