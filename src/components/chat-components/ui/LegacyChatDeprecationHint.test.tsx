import {
  LegacyChatDeprecationHint,
  type LegacyChatDeprecationHintProps,
} from "@/components/chat-components/ui/LegacyChatDeprecationHint";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const COPY = "V3 Chat will be deprecated soon. Use opencode for BYOK.";

describe("LegacyChatDeprecationHint", () => {
  describe("LegacyChatDeprecationHint()", () => {
    it("explains the supported BYOK path and opens Agent when selected", () => {
      const onOpenAgent = jest.fn();
      const props: LegacyChatDeprecationHintProps = { onOpenAgent };

      render(<LegacyChatDeprecationHint {...props} />);
      fireEvent.click(screen.getByRole("button", { name: COPY }));

      expect(onOpenAgent).toHaveBeenCalledTimes(1);
    });
  });
});
