import { render, screen } from "@testing-library/react";
import React from "react";
import { SkillRowLayout } from "./SkillRowLayout";

describe("SkillRowLayout", () => {
  describe("SkillRowLayout()", () => {
    it("shares name, description, annotations and controls across skill ownership for https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      render(
        <SkillRowLayout
          name="writing-helper"
          description="Review writing"
          annotations={<span>Requires Miyo</span>}
          controls={<button type="button">Agent</button>}
          actions={<button type="button">More actions</button>}
        />
      );
      expect(screen.getByText("writing-helper")).toBeTruthy();
      expect(screen.getByText("Review writing")).toBeTruthy();
      expect(screen.getByText("Requires Miyo")).toBeTruthy();
      expect(screen.getAllByRole("button")).toHaveLength(2);
    });
  });
});
