import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import { ReactModal } from "@/components/modals/ReactModal";
import { RenameChatForm, RenameChatModal } from "@/agentMode/ui/RenameChatModal";

function renderForm(overrides: Partial<React.ComponentProps<typeof RenameChatForm>> = {}) {
  const props = {
    initialTitle: "Plan the fall launch",
    onSave: jest.fn(async () => {}),
    onCancel: jest.fn(),
    ...overrides,
  };
  render(<RenameChatForm {...props} />);
  return props;
}

describe("RenameChatModal", () => {
  describe("RenameChatForm()", () => {
    it("prefills the title field with the chat's current title", () => {
      renderForm();

      expect(screen.getByRole("textbox", { name: "Chat title" })).toHaveProperty(
        "value",
        "Plan the fall launch"
      );
    });

    it("saves the trimmed title when Save is clicked", () => {
      const { onSave } = renderForm();

      fireEvent.change(screen.getByRole("textbox", { name: "Chat title" }), {
        target: { value: "  Launch checklist  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(onSave).toHaveBeenCalledWith("Launch checklist");
    });

    it("saves the title when Enter is pressed in the title field", () => {
      const { onSave } = renderForm();
      const field = screen.getByRole("textbox", { name: "Chat title" });

      fireEvent.change(field, { target: { value: "Launch checklist" } });
      fireEvent.submit(field);

      expect(onSave).toHaveBeenCalledWith("Launch checklist");
    });

    it("cancels without saving when Cancel is clicked", () => {
      const { onSave, onCancel } = renderForm();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
    });

    it("disables Save while the title is blank", () => {
      renderForm();

      fireEvent.change(screen.getByRole("textbox", { name: "Chat title" }), {
        target: { value: "   " },
      });

      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    });
  });

  describe("RenameChatModal", () => {
    afterEach(() => document.body.replaceChildren());

    async function openModal(onRename: (title: string) => Promise<void>) {
      const modal = new RenameChatModal(new App(), "Plan the fall launch", onRename);
      modal.contentEl.empty = () => modal.contentEl.replaceChildren();
      document.body.appendChild(modal.containerEl);
      await act(async () => ReactModal.prototype.onOpen.call(modal));
      return modal;
    }

    describe("constructor()", () => {
      it("titles the native dialog Rename chat", () => {
        const modal = new RenameChatModal(new App(), "Plan the fall launch", jest.fn());

        expect(modal.titleEl.textContent).toBe("Rename chat");
      });
    });

    describe("onOpen()", () => {
      it("renames the chat and closes the dialog when the new title is saved", async () => {
        const onRename = jest.fn(async () => {});
        const modal = await openModal(onRename);

        fireEvent.change(within(modal.contentEl).getByRole("textbox", { name: "Chat title" }), {
          target: { value: "Launch checklist" },
        });
        await act(async () => {
          fireEvent.click(within(modal.contentEl).getByRole("button", { name: "Save" }));
        });

        expect(onRename).toHaveBeenCalledWith("Launch checklist");
        expect(modal.close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });

      it("https://github.com/logancyang/obsidian-copilot/issues/3040 keeps the dialog open with the draft when renaming fails", async () => {
        const onRename = jest.fn(async () => {
          throw new Error("rename failed");
        });
        const modal = await openModal(onRename);

        fireEvent.change(within(modal.contentEl).getByRole("textbox", { name: "Chat title" }), {
          target: { value: "Retained draft" },
        });
        await act(async () => {
          fireEvent.click(within(modal.contentEl).getByRole("button", { name: "Save" }));
        });

        expect(onRename).toHaveBeenCalledWith("Retained draft");
        expect(modal.close).not.toHaveBeenCalled();
        expect(within(modal.contentEl).getByDisplayValue("Retained draft")).toBeTruthy();
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});
