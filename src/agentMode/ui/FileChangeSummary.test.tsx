import React from "react";
import { render } from "@testing-library/react";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";

describe("FileChangeSummary", () => {
  describe("FileChangeCounts()", () => {
    it("shows the addition count with a plus and the deletion count with a minus sign, including zeros", () => {
      const { container } = render(<FileChangeCounts additions={4} deletions={0} />);

      expect(container.textContent).toBe("+4−0");
    });
  });

  describe("FileChangeStatusBadge()", () => {
    it.each([
      ["created", "new"],
      ["deleted", "deleted"],
      ["modified", ""],
    ] as const)("labels a %s file as %j", (status, label) => {
      const { container } = render(<FileChangeStatusBadge status={status} />);

      expect(container.textContent).toBe(label);
    });
  });
});
