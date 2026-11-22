import { QuickChatPromptSelect } from "@/components/chat-components/ui/QuickChatPromptSelect";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("QuickChatPromptSelect", () => {
  describe("QuickChatPromptSelect()", () => {
    it("offers vault instructions and saved prompts and reports the chosen value", () => {
      const selected: string[] = [];
      render(
        <QuickChatPromptSelect
          prompts={[{ title: "Writing coach" }]}
          value=""
          onChange={(event) => selected.push(event.target.value)}
        />
      );
      const select = screen.getByRole<HTMLSelectElement>("combobox");
      expect(Array.from(select.options, (option) => option.text)).toEqual([
        "Default (AGENTS.md)",
        "Writing coach",
      ]);
      fireEvent.change(select, { target: { value: "Writing coach" } });
      expect(selected).toEqual(["Writing coach"]);
    });
  });
});
