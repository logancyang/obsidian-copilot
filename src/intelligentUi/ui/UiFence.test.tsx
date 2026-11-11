import { UiFence } from "@/intelligentUi/ui/UiFence";
import { render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/883";
describe("UiFence", () => {
  describe("UiFence()", () => {
    it(`shows completed descendants during streaming and restores full source after stop (${ISSUE})`, () => {
      const source = '<stack><text>Done</text><card title="partial';
      const view = render(<UiFence source={source} sourcePath="" streaming closed={false} />);
      expect(screen.getByText("Done")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("Receiving layout…");
      view.rerender(<UiFence source={source} sourcePath="" streaming={false} closed={false} />);
      expect(view.container.querySelector("pre code")?.textContent).toBe(source);
    });
    it(`preserves closed incomplete source even while later prose streams (${ISSUE})`, () => {
      const source = '<card title="unfinished';
      const { container } = render(<UiFence source={source} sourcePath="" streaming closed />);
      expect(container.querySelector("code")?.textContent).toBe(source);
    });
    it(`renders malformed source through the unchanged readable fallback (${ISSUE})`, () => {
      const source = "<script>bad</script>";
      const { container } = render(
        <UiFence source={source} sourcePath="" streaming closed={false} />
      );
      expect(screen.getByRole("status").textContent).toContain("could not be displayed");
      expect(container.querySelector("code")?.textContent).toBe(source);
      expect(container.querySelector("script")).toBeNull();
    });
    it("removes the pending indicator and keeps completed cards mounted when the fence closes", () => {
      const source = '<card title="Ready"><text>Done</text></card>';
      const view = render(<UiFence source={source} sourcePath="" streaming closed={false} />);
      const card = screen.getByRole("region", { name: "Ready" });
      view.rerender(<UiFence source={source} sourcePath="" streaming={false} closed />);
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByRole("region", { name: "Ready" })).toBe(card);
    });
  });
});
