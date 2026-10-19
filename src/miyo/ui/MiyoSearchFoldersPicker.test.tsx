import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MiyoSearchFoldersPicker } from "./MiyoSearchFoldersPicker";

const FOLDERS = [
  { name: "Research", isChat: false },
  { name: "ChatGPT", isChat: true },
];

describe("MiyoSearchFoldersPicker", () => {
  describe("MiyoSearchFoldersPicker()", () => {
    it("lists the other Miyo folders with the saved ones ticked and marks synced chat folders as Chat", () => {
      render(
        <MiyoSearchFoldersPicker folders={FOLDERS} selected={["ChatGPT"]} onChange={jest.fn()} />
      );

      expect(screen.getByRole("checkbox", { name: "Research" }).getAttribute("aria-checked")).toBe(
        "false"
      );
      const chat = screen.getByRole("checkbox", { name: "ChatGPT" });
      expect(chat.getAttribute("aria-checked")).toBe("true");
      expect(chat.closest("label")?.textContent).toContain("Chat");
      expect(screen.getByRole("checkbox", { name: "Research" }).closest("label")?.textContent).toBe(
        "Research"
      );
    });

    it("adds a folder to the saved selection when ticked and removes it when unticked", () => {
      const onChange = jest.fn();
      render(
        <MiyoSearchFoldersPicker folders={FOLDERS} selected={["ChatGPT"]} onChange={onChange} />
      );

      fireEvent.click(screen.getByRole("checkbox", { name: "Research" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "ChatGPT" }));

      expect(onChange.mock.calls).toEqual([[["ChatGPT", "Research"]], [[]]]);
    });

    it("keeps a ticked folder that Miyo does not list, marked Not in Miyo, so it can be unticked — https://github.com/logancyang/obsidian-copilot/issues/3508", () => {
      const onChange = jest.fn();
      render(
        <MiyoSearchFoldersPicker
          folders={FOLDERS}
          selected={["Research", "Old laptop vault"]}
          onChange={onChange}
        />
      );

      const missing = screen.getByRole("checkbox", { name: "Old laptop vault" });
      expect(missing.getAttribute("aria-checked")).toBe("true");
      expect(missing.closest("label")?.textContent).toContain("Not in Miyo");
      fireEvent.click(missing);
      expect(onChange).toHaveBeenCalledWith(["Research"]);
    });

    it("shows a loading message and no folders while the list is being fetched", () => {
      render(<MiyoSearchFoldersPicker selected={["Research"]} onChange={jest.fn()} />);

      expect(screen.getByText("Loading Miyo folders…")).toBeTruthy();
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("shows the error and no folders when the list could not be fetched", () => {
      render(
        <MiyoSearchFoldersPicker
          error="Couldn't load your Miyo folders."
          selected={["Research"]}
          onChange={jest.fn()}
        />
      );

      expect(screen.getByText("Couldn't load your Miyo folders.")).toBeTruthy();
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("says Miyo has no other folders when it lists none and none are ticked", () => {
      render(<MiyoSearchFoldersPicker folders={[]} selected={[]} onChange={jest.fn()} />);

      expect(screen.getByText("Miyo has no other folders yet.")).toBeTruthy();
    });
  });
});
