import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("setting-disclosure", () => {
  describe("SettingDisclosure", () => {
    it("exposes a button named after the label, defaulting to Advanced", () => {
      const { rerender } = render(<SettingDisclosure open={false} />);
      expect(screen.getByRole("button", { name: "Advanced" })).not.toBeNull();

      rerender(<SettingDisclosure open={false} label="Debugging" />);
      expect(screen.getByRole("button", { name: "Debugging" })).not.toBeNull();
    });

    it("reports the disclosed state through aria-expanded", () => {
      const { rerender } = render(<SettingDisclosure open={false} />);
      expect(screen.getByRole("button", { name: "Advanced" }).getAttribute("aria-expanded")).toBe(
        "false"
      );

      rerender(<SettingDisclosure open />);
      expect(screen.getByRole("button", { name: "Advanced" }).getAttribute("aria-expanded")).toBe(
        "true"
      );
    });

    it("forwards click handling to the caller", () => {
      const onClick = jest.fn();
      render(<SettingDisclosure open={false} onClick={onClick} />);

      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    // The row doubles as a Radix `CollapsibleTrigger asChild` target, which only
    // works if the component forwards its ref and the injected props.
    it("drives a Collapsible when used as its trigger", () => {
      render(
        <Collapsible>
          <CollapsibleTrigger asChild>
            <SettingDisclosure open={false} />
          </CollapsibleTrigger>
          <CollapsibleContent>Filename template</CollapsibleContent>
        </Collapsible>
      );
      expect(screen.queryByText("Filename template")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

      expect(screen.getByText("Filename template")).not.toBeNull();
    });
  });
});
