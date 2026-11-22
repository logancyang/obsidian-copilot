import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectInstructionsField } from "@/instructions/ProjectInstructionsField";

describe("ProjectInstructionsField", () => {
  it("shows the draft and says where the text is saved", () => {
    render(<ProjectInstructionsField value="Cite only #verified notes." onChange={jest.fn()} />);

    expect(screen.getByLabelText<HTMLTextAreaElement>("Project instructions").value).toBe(
      "Cite only #verified notes."
    );
    expect(screen.getByText(/Saved to AGENTS\.md in the project folder/)).toBeTruthy();
  });

  it("reports each edit so the dialog can hold the draft", () => {
    const onChange = jest.fn();
    render(<ProjectInstructionsField value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Project instructions"), {
      target: { value: "New rules" },
    });

    expect(onChange).toHaveBeenCalledWith("New rules");
  });
});
