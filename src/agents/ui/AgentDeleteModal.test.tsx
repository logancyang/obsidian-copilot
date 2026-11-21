import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import {
  AgentDeleteForm,
  AgentDeleteModal,
  type AgentDeleteFormProps,
} from "@/agents/ui/AgentDeleteModal";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";

const COCO: AgentDeleteFormProps["agent"] = {
  name: "Coco",
  instructionsPath: "copilot/teammates/coco/instructions.md",
  memoryPath: "copilot/teammates/coco/MEMORY.md",
  faceSrc: "app://vault/copilot/teammates/coco/face.webp",
};

function renderForm(props: Partial<AgentDeleteFormProps> = {}) {
  const handlers = { onDelete: jest.fn(), onCancel: jest.fn() };
  render(<AgentDeleteForm agent={COCO} memoryRules={9} chatCount={23} {...handlers} {...props} />);
  return handlers;
}

describe("AgentDeleteModal", () => {
  describe("AgentDeleteForm()", () => {
    it(`lists both files with where they live and the face as what goes, and says it can't be undone (${ISSUE})`, () => {
      renderForm();

      expect(
        screen.getByText("This deletes Coco and everything below. You can't undo it.")
      ).not.toBeNull();
      expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "What Coco handlescopilot/teammates/coco/instructions.md",
        "Rules Coco remembers · 9 rulescopilot/teammates/coco/MEMORY.md",
        "Coco's face",
      ]);
    });

    it(`says below the list, outside it, that the agent's chats are archived and not deleted, and where to find them (${ISSUE})`, () => {
      renderForm();

      const chats = screen.getByText(
        "23 chats with Coco will be archived, not deleted. You can find them under View archived."
      );
      expect(chats.closest("ul")).toBeNull();
      expect(
        screen.getByText("What Coco said in chats with other teammates stays there.")
      ).not.toBeNull();
    });

    it(`lists no memory file and no face for a new agent that has neither, and speaks of a single chat in the singular (${ISSUE})`, () => {
      renderForm({
        agent: { ...COCO, faceSrc: NEUTRAL_FACE_SRC },
        memoryRules: null,
        chatCount: 1,
      });

      expect(screen.queryByText("Rules Coco remembers")).toBeNull();
      expect(screen.queryByText("Coco's face")).toBeNull();
      expect(
        screen.getByText(
          "1 chat with Coco will be archived, not deleted. You can find it under View archived."
        )
      ).not.toBeNull();
    });

    it(`says nothing about chats for an agent nobody has chatted with yet (${ISSUE})`, () => {
      renderForm({ chatCount: 0 });

      expect(screen.queryByText(/archived/)).toBeNull();
      expect(screen.getByText("What Coco handles")).not.toBeNull();
    });

    it(`says in orange which chat the agent is working in and that deleting stops it, only while it works there (https://github.com/Brevilabs/obsidian-copilot-private/issues/945)`, () => {
      renderForm({ workingIn: "Maya" });

      const line = screen.getByText("Coco is working in Maya's chat. Deleting stops it.");
      expect(line.className).toContain("tw-text-warning");
    });

    it(`says nothing about a run when the agent isn't working in another chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/945)`, () => {
      renderForm({ workingIn: null });

      expect(screen.queryByText(/is working in/)).toBeNull();
    });

    it(`puts the keyboard on Cancel, so Enter does not delete, and names the agent on the delete button (${ISSUE})`, () => {
      const { onDelete, onCancel } = renderForm();

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete Coco" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe("AgentDeleteModal", () => {
    describe("constructor()", () => {
      it("asks to delete the agent by name in the dialog's title", () => {
        const modal = new AgentDeleteModal(
          new App(),
          { agent: COCO, memoryRules: 9, chatCount: 23 },
          jest.fn()
        );

        expect(modal.titleEl.textContent).toBe("Delete Coco?");
      });
    });

    describe("renderContent()", () => {
      it("closes the dialog before deleting", () => {
        const order: string[] = [];
        const modal = new AgentDeleteModal(
          new App(),
          { agent: COCO, memoryRules: 9, chatCount: 23 },
          () => order.push("delete")
        );

        render(
          (
            modal as unknown as { renderContent: (close: () => void) => React.ReactElement }
          ).renderContent(() => order.push("close"))
        );
        fireEvent.click(screen.getByRole("button", { name: "Delete Coco" }));

        expect(order).toEqual(["close", "delete"]);
      });
    });
  });
});
