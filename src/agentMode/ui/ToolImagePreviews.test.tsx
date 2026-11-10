import { ToolImagePreviews } from "@/agentMode/ui/ToolImagePreviews";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("ToolImagePreviews", () => {
  describe("ToolImagePreviews()", () => {
    it("shows each returned image with an accessible tool label https://github.com/logancyang/obsidian-copilot/issues/4227", () => {
      render(
        <ToolImagePreviews
          label="Read diagram"
          outputs={[
            { type: "text", text: "Image read" },
            { type: "image", mimeType: "image/png", data: "AQID" },
            { type: "image", mimeType: "image/jpeg", data: "BAUG" },
          ]}
        />
      );
      expect(screen.getAllByRole("img").map((image) => image.getAttribute("src"))).toEqual([
        "data:image/png;base64,AQID",
        "data:image/jpeg;base64,BAUG",
      ]);
      expect(screen.getByAltText("Image viewed by agent: Read diagram (1)")).toBeTruthy();
    });

    it("holds a same-size empty box in place of an image that is still being shrunk https://github.com/logancyang/obsidian-copilot/issues/4248", () => {
      render(
        <ToolImagePreviews
          label="Read chart"
          outputs={[
            { type: "image", mimeType: "image/webp", data: "VEhVTUI=" },
            { type: "image_pending", key: "chart" },
          ]}
        />
      );
      expect(screen.getAllByRole("img").map((image) => image.getAttribute("src"))).toEqual([
        "data:image/webp;base64,VEhVTUI=",
      ]);
      const pending = screen.getByLabelText("Preparing image viewed by agent: Read chart (2)");
      expect(pending.tagName).toBe("DIV");
    });

    it("renders nothing without image results https://github.com/logancyang/obsidian-copilot/issues/4227", () => {
      const { container, rerender } = render(<ToolImagePreviews label="Read note" />);
      expect(container.childElementCount).toBe(0);
      rerender(
        <ToolImagePreviews label="Read note" outputs={[{ type: "text", text: "Note read" }]} />
      );
      expect(container.childElementCount).toBe(0);
    });
  });
});
