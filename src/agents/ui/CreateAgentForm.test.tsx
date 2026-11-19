import type { NewCustomAgent } from "@/agents/CustomAgentStore";
import {
  CreateAgentCloseGuard,
  CreateAgentForm,
  type CreateAgentFormProps,
} from "@/agents/ui/CreateAgentForm";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";
const NAMES_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/936";

const LEO = { slug: "leo", name: "Leo" };

function renderForm(props: Partial<CreateAgentFormProps> = {}) {
  const onCreate = jest.fn<Promise<void>, [NewCustomAgent]>().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const closeGuard = new CreateAgentCloseGuard();
  render(
    <TooltipProvider>
      <CreateAgentForm
        agents={[LEO]}
        folderNames={["leo"]}
        agentsFolder="copilot/agents"
        closeGuard={closeGuard}
        onCreate={onCreate}
        onClose={onClose}
        {...props}
      />
    </TooltipProvider>
  );
  return { onCreate, onClose, closeGuard };
}

function type(label: string | RegExp, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

function createButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Create" });
}

async function createButtonHint(): Promise<string> {
  fireEvent.focus(createButton().parentElement as HTMLElement);
  return (await screen.findByRole("tooltip")).textContent ?? "";
}

describe("CreateAgentForm", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });

  describe("CreateAgentForm()", () => {
    it("opens empty with the name focused, an optional title, What it handles, and Create unavailable", () => {
      renderForm();

      expect(document.activeElement).toBe(screen.getByLabelText("Name"));
      expect(screen.getByLabelText(/Title/).getAttribute("placeholder")).toBe(
        "One line under the name, e.g. Writes the newsletter"
      );
      expect(screen.getByLabelText("What it handles").getAttribute("placeholder")).toMatch(
        /^e\.g\. You keep the books for my company\./
      );
      expect(screen.getByText("Saved in copilot/agents/")).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton().disabled).toBe(true);
    });

    it("names the agent in the instruction's label, its hint and the folder it is saved in as the name is typed", () => {
      renderForm();

      type("Name", "Kai");

      expect(screen.getByLabelText("What Kai handles")).not.toBeNull();
      expect(screen.getByText(/Kai reads this at the start of every chat\./)).not.toBeNull();
      expect(screen.getByText("Saved in copilot/agents/kai/")).not.toBeNull();
    });

    it("creates the agent from the trimmed name and title and the instruction, on the default model", async () => {
      const { onCreate } = renderForm();

      type("Name", "  Kai ");
      type(/Title/, " Writes launch posts ");
      type("What Kai handles", "You handle marketing.\n");
      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate).toHaveBeenCalledWith({
          name: "Kai",
          title: "Writes launch posts",
          model: null,
          instruction: "You handle marketing.",
        })
      );
    });

    it(`keeps Create unavailable without a name and says to give it a name first (${ISSUE})`, async () => {
      renderForm();

      type("What it handles", "You handle marketing.");

      expect(createButton().disabled).toBe(true);
      expect(await createButtonHint()).toBe("Give it a name first");
    });

    it(`says a name is already on the team whatever its case, names no folder for it, and keeps Create unavailable (${ISSUE})`, async () => {
      renderForm();

      type("Name", "leo");
      type("What leo handles", "You handle marketing.");

      expect(screen.getByRole("alert").textContent).toBe(
        "Leo is already on your team. Pick another name."
      );
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Saved in copilot/agents/")).not.toBeNull();
      expect(createButton().disabled).toBe(true);
    });

    it.each([
      {
        case: "an agent renamed since",
        props: { agents: [{ slug: "leo", name: "Chief" }] },
        name: "Leo",
        message: "Chief already uses the folder leo. Pick another name.",
      },
      {
        case: "a folder holding no agent",
        props: { folderNames: ["leo", "Kai"] },
        name: "Kai",
        message: "A folder named kai already exists in your agents folder. Pick another name.",
      },
    ])(
      `says when $case already has the name's folder, names no folder for it, and keeps Create unavailable (${NAMES_ISSUE})`,
      async ({ props, name, message }) => {
        renderForm(props);

        type("Name", name);
        type(`What ${name} handles`, "You handle marketing.");

        expect(screen.getByRole("alert").textContent).toBe(message);
        expect(screen.getByText("Saved in copilot/agents/")).not.toBeNull();
        expect(createButton().disabled).toBe(true);
        expect(await createButtonHint()).toBe(message);
      }
    );

    it(`notes that long names get cut off in tabs once a name passes 12 characters, without limiting it (${ISSUE})`, () => {
      renderForm();

      type("Name", "Twelve chars");
      expect(screen.queryByText("Long names get cut off in tabs.")).toBeNull();

      type("Name", "Thirteen char");
      expect(screen.getByText("Long names get cut off in tabs.")).not.toBeNull();
    });

    it(`says why the instruction is needed once the user leaves it empty, not before, and Create says to write it first (${ISSUE})`, async () => {
      renderForm();
      type("Name", "Kai");
      expect(screen.queryByRole("alert")).toBeNull();

      fireEvent.blur(screen.getByLabelText("What Kai handles"));

      expect(screen.getByRole("alert").textContent).toBe(
        "Write at least one sentence. Without it, Kai is just Copilot with a face."
      );
      expect(await createButtonHint()).toBe("Write what Kai handles first");
    });

    it(`counts the instruction's characters and turns the count orange past 4,000 without blocking Create (${ISSUE})`, () => {
      renderForm();
      type("Name", "Kai");

      type("What Kai handles", "x".repeat(4000));
      expect(screen.getByText("4,000 / 4,000").className).toContain("tw-text-faint");

      type("What Kai handles", "x".repeat(4001));
      expect(screen.getByText("4,001 / 4,000").className).toContain("tw-text-warning");
      expect(createButton().disabled).toBe(false);
    });

    it(`keeps everything typed and says why when creating the agent fails (${ISSUE})`, async () => {
      const onCreate = jest.fn().mockRejectedValue(new Error("Custom agents are not available."));
      renderForm({ onCreate });
      type("Name", "Kai");
      type("What Kai handles", "You handle marketing.");

      fireEvent.click(createButton());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Couldn't create Kai. Custom agents are not available."
      );
      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Kai");
      expect(screen.getByLabelText<HTMLInputElement>("What Kai handles").value).toBe(
        "You handle marketing."
      );
      expect(createButton().disabled).toBe(false);
    });

    it("creates the agent when Enter is pressed in the name field once it is ready", async () => {
      const { onCreate } = renderForm();
      type("What it handles", "You handle marketing.");
      type("Name", "Kai");

      fireEvent.submit(screen.getByLabelText("Name"));

      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    });

    it(`shows why the instruction is needed when Enter is pressed before it is written (${ISSUE})`, () => {
      const { onCreate } = renderForm();
      type("Name", "Kai");

      fireEvent.submit(screen.getByLabelText("Name"));

      expect(screen.getByRole("alert").textContent).toMatch(/^Write at least one sentence\./);
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("asks its dialog to close on Cancel", () => {
      const { onClose } = renderForm();
      type("Name", "Kai");

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it(`tells its dialog whether any text is typed and the name to ask about before discarding it (${ISSUE})`, () => {
      const { closeGuard } = renderForm();
      expect(closeGuard.hasInput).toBe(false);

      type("What it handles", "You handle marketing.");
      expect(closeGuard).toMatchObject({ hasInput: true, name: "" });

      type("Name", "  Kai ");
      expect(closeGuard).toMatchObject({ hasInput: true, name: "Kai" });
    });

    it("starts from the values it is given", () => {
      renderForm({
        initialValues: {
          name: "Nora",
          title: "Family logistics",
          instruction: "You plan pickups.",
        },
      });

      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Nora");
      expect(screen.getByLabelText<HTMLInputElement>(/Title/).value).toBe("Family logistics");
      expect(screen.getByLabelText<HTMLInputElement>("What Nora handles").value).toBe(
        "You plan pickups."
      );
      expect(createButton().disabled).toBe(false);
    });
  });
});
