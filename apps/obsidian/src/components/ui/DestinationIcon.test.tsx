import { DestinationIcon } from "@/components/ui/DestinationIcon";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("DestinationIcon", () => {
  describe("DestinationIcon()", () => {
    it("names the destination, and the extra note when one is given, for https://github.com/logancyang/obsidian-copilot/issues/2889", () => {
      const lock = { kind: "lock", label: "Brevilabs servers (US)" } as const;
      const { rerender } = render(<DestinationIcon destination={lock} />);
      expect(screen.getByText("Sends requests to: Brevilabs servers (US)")).toBeTruthy();

      rerender(<DestinationIcon destination={lock} note="Copilot license required" />);
      expect(
        screen.getByText("Sends requests to: Brevilabs servers (US) Copilot license required", {
          normalizer: (text) => text.replace(/\s+/g, " "),
        })
      ).toBeTruthy();
    });
  });
});
