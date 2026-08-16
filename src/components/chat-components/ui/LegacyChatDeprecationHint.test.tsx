import {
  LegacyChatDeprecationHint,
  type LegacyChatDeprecationHintProps,
} from "@/components/chat-components/ui/LegacyChatDeprecationHint";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const COPY = "V3 Chat will be deprecated soon. Use opencode for BYOK and Copilot-hosted models.";

describe("LegacyChatDeprecationHint", () => {
  describe("LegacyChatDeprecationHint()", () => {
    it("shows deprecation guidance with an alert icon and opens Agent when selected", () => {
      const onOpenAgent = jest.fn();
      const props: LegacyChatDeprecationHintProps = { onOpenAgent };

      const { container } = render(<LegacyChatDeprecationHint {...props} />);

      expect(container.querySelector(".lucide-circle-alert")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: COPY }));

      expect(onOpenAgent).toHaveBeenCalledTimes(1);
    });
  });
});
