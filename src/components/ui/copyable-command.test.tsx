import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";
import { CopyableCommand } from "./copyable-command";

jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("obsidian", () => ({ Notice: jest.fn() }));

const writeText = jest.fn();

describe("CopyableCommand", () => {
  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies the exact command and announces success", async () => {
    writeText.mockResolvedValue(undefined);
    render(<CopyableCommand label="Replacement command" command="old && new --exact" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy replacement command" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("old && new --exact"));
    expect(await screen.findByText("Replacement command copied")).not.toBeNull();
  });

  it("surfaces a clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<CopyableCommand label="Replacement command" command="replace" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy replacement command" }));

    await waitFor(() =>
      expect(Notice).toHaveBeenCalledWith("Failed to copy command to clipboard.")
    );
  });
});
