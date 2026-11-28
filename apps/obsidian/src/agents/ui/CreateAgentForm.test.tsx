import type { NewCustomAgent } from "@/agents/CustomAgentStore";
import {
  CreateAgentCloseGuard,
  CreateAgentForm,
  type AgentModelChoices,
  type CreateAgentFormProps,
} from "@/agents/ui/CreateAgentForm";
import type { PresetFacesState } from "@/agents/ui/usePresetFaces";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";
const DRAFT_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/941";
const NAMES_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/936";

const MODELS: AgentModelChoices = {
  models: [
    {
      name: "opus",
      displayName: "Opus 5.5",
      provider: "agent",
      enabled: true,
      _group: "Claude",
      _backendId: "claude",
    },
    {
      name: "sonnet",
      displayName: "Sonnet 5.5",
      provider: "agent",
      enabled: true,
      _group: "Claude",
      _backendId: "claude",
    },
  ],
  effortOptionsByModelKey: {
    "claude:opus|agent": [
      { label: "medium", value: "medium" },
      { label: "high", value: "high" },
    ],
    "claude:sonnet|agent": [
      { label: "low", value: "low" },
      { label: "medium", value: "medium" },
    ],
  },
  initial: { baseModelId: "opus", effort: "high" },
};

const LEO = { slug: "leo", name: "Leo" };

const LEO_BYTES = new Uint8Array([1]).buffer;
const KAI_BYTES = new Uint8Array([2]).buffer;
const NORA_BYTES = new Uint8Array([3]).buffer;
const presetsWithLeoUsed: PresetFacesState = {
  status: "ready",
  faces: [
    { id: "leo", alt: "Face with a beard", bytes: LEO_BYTES, src: "data:image/webp;base64,bGVv" },
    {
      id: "kai",
      alt: "Face with round glasses",
      bytes: KAI_BYTES,
      src: "data:image/webp;base64,a2Fp",
    },
    {
      id: "nora",
      alt: "Face with a peace sign",
      bytes: NORA_BYTES,
      src: "data:image/webp;base64,bm9yYQ==",
    },
  ],
  usedIds: new Set(["leo"]),
};

function faceShown(): string | undefined {
  return (
    screen.getByRole("button", { name: "Change face" }).querySelector("img")?.getAttribute("src") ??
    undefined
  );
}

function renderForm(props: Partial<CreateAgentFormProps> = {}) {
  const onCreate = jest.fn<Promise<void>, [NewCustomAgent]>().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const closeGuard = new CreateAgentCloseGuard();
  render(
    <TooltipProvider>
      <CreateAgentForm
        agents={[LEO]}
        folderNames={["leo"]}
        agentsFolder="copilot/teammates"
        models={MODELS}
        presetFaces={{ status: "loading" }}
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

function enterName(text: string) {
  type("Name", text);
  fireEvent.blur(screen.getByLabelText("Name"));
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
    window.createImageBitmap = jest.fn().mockResolvedValue({ close: jest.fn() });
  });

  describe("CreateAgentForm()", () => {
    it("opens empty with the name focused, an optional title, What it handles, the default model, and Create unavailable", () => {
      renderForm();

      expect(document.activeElement).toBe(screen.getByLabelText("Name"));
      expect(screen.getByLabelText("Name").getAttribute("placeholder")).toBe("e.g. Leo");
      expect(screen.getByLabelText(/Title/).getAttribute("placeholder")).toBe(
        "One line under the name, e.g. Writes the newsletter"
      );
      expect(screen.getByLabelText("What it handles").getAttribute("placeholder")).toMatch(
        /^e\.g\. You keep the books for my company\./
      );
      expect(screen.getByTitle("Model · effort").textContent).toContain("Opus 5.5");
      expect(screen.getByTitle("Model · effort").textContent).toContain("high");
      expect(screen.getByText("Saved in copilot/teammates/")).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton().disabled).toBe(true);
    });

    it(`names the agent in the instruction's label, its hint and the folder it is saved in once the name field is left, not while it is typed (${ISSUE})`, () => {
      renderForm();

      type("Name", "Kai");
      expect(screen.getByLabelText("What it handles")).not.toBeNull();
      expect(screen.getByText(/It reads this at the start of every chat\./)).not.toBeNull();
      expect(screen.getByText("Saved in copilot/teammates/")).not.toBeNull();

      fireEvent.blur(screen.getByLabelText("Name"));
      expect(screen.getByLabelText("What Kai handles")).not.toBeNull();
      expect(screen.getByText(/Kai reads this at the start of every chat\./)).not.toBeNull();
      expect(screen.getByText("Saved in copilot/teammates/kai/")).not.toBeNull();

      type("Name", "Kaia");
      expect(screen.getByLabelText("What Kai handles")).not.toBeNull();
      expect(screen.getByText("Saved in copilot/teammates/kai/")).not.toBeNull();
    });

    it(`says a taken name and updates Create on every key, before the name field is left (${ISSUE})`, async () => {
      renderForm();
      type("What it handles", "You handle marketing.");

      type("Name", "leo");
      expect(screen.getByRole("alert").textContent).toBe(
        "Leo is already on your team. Pick another name."
      );
      expect(createButton().disabled).toBe(true);
      expect(await createButtonHint()).toBe("Leo is already on your team. Pick another name.");

      type("Name", "leon");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton().disabled).toBe(false);
    });

    it(`creates the agent with the name in the field even when the field was never left (${ISSUE})`, async () => {
      const { onCreate } = renderForm();
      type("What it handles", "You handle marketing.");
      type("Name", "Kai");

      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Kai" }))
      );
    });

    it("creates the agent from the trimmed name and title, the instruction and the default model", async () => {
      const { onCreate } = renderForm();

      enterName("  Kai ");
      type(/Title/, " Writes launch posts ");
      type("What Kai handles", "You handle marketing.\n");
      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate).toHaveBeenCalledWith({
          name: "Kai",
          title: "Writes launch posts",
          model: { baseModelId: "opus", effort: "high" },
          instruction: "You handle marketing.",
          face: undefined,
        })
      );
    });

    it("creates the agent on the model and effort picked from the model list", async () => {
      const { onCreate } = renderForm();
      enterName("Kai");
      type("What Kai handles", "You handle marketing.");

      fireEvent.click(screen.getByTitle("Model · effort"));
      fireEvent.click(await screen.findByRole("option", { name: /Sonnet 5\.5/ }));
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate.mock.calls[0][0].model).toEqual({ baseModelId: "sonnet", effort: "low" })
      );
    });

    it("creates the agent with an uploaded image as its face, shown in place of the empty face", async () => {
      const { onCreate } = renderForm();
      const photo = new File(["png bytes"], "kai.png", { type: "image/png" });
      enterName("Kai");
      type("What Kai handles", "You handle marketing.");

      fireEvent.click(screen.getByRole("button", { name: "Change face" }));
      fireEvent.change(await screen.findByLabelText("Upload image"), {
        target: { files: [photo] },
      });
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Change face" }).querySelector("img")?.src
        ).toMatch(/^data:image\/png;base64,/)
      );
      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate.mock.calls[0][0].face).toEqual({ kind: "upload", image: photo })
      );
    });

    it(`opens on the first preset face no other agent wears and creates the agent with its bytes (${ISSUE})`, async () => {
      const { onCreate } = renderForm({ presetFaces: presetsWithLeoUsed });
      enterName("Kai");
      type("What Kai handles", "You handle marketing.");

      expect(faceShown()).toBe("data:image/webp;base64,a2Fp");
      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate.mock.calls[0][0].face).toEqual({ kind: "preset", bytes: KAI_BYTES })
      );
    });

    it("creates the agent with the preset face picked from the grid", async () => {
      const { onCreate } = renderForm({ presetFaces: presetsWithLeoUsed });
      enterName("Kai");
      type("What Kai handles", "You handle marketing.");

      fireEvent.click(screen.getByRole("button", { name: "Change face" }));
      fireEvent.click(await screen.findByRole("button", { name: "Face with a peace sign" }));
      fireEvent.click(createButton());

      expect(faceShown()).toBe("data:image/webp;base64,bm9yYQ==");
      await waitFor(() =>
        expect(onCreate.mock.calls[0][0].face).toEqual({ kind: "preset", bytes: NORA_BYTES })
      );
    });

    it(`opens with the empty face while the preset faces load or when they could not load (${ISSUE})`, () => {
      renderForm({ presetFaces: { status: "failed" } });

      expect(faceShown()).toMatch(/^data:image\/svg\+xml,/);
    });

    it(`keeps Create unavailable without a name and says to give it a name first (${ISSUE})`, async () => {
      renderForm();

      type("What it handles", "You handle marketing.");

      expect(createButton().disabled).toBe(true);
      expect(await createButtonHint()).toBe("Give it a name first");
    });

    it(`says a name is already on the team whatever its case, names no folder for it, and keeps Create unavailable (${ISSUE})`, async () => {
      renderForm();

      enterName("leo");
      type("What leo handles", "You handle marketing.");

      expect(screen.getByRole("alert").textContent).toBe(
        "Leo is already on your team. Pick another name."
      );
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Saved in copilot/teammates/")).not.toBeNull();
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
        message: "A folder named kai already exists in your teammates folder. Pick another name.",
      },
    ])(
      `says when $case already has the name's folder, names no folder for it, and keeps Create unavailable (${NAMES_ISSUE})`,
      async ({ props, name, message }) => {
        renderForm(props);

        enterName(name);
        type(`What ${name} handles`, "You handle marketing.");

        expect(screen.getByRole("alert").textContent).toBe(message);
        expect(screen.getByText("Saved in copilot/teammates/")).not.toBeNull();
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
      enterName("Kai");
      expect(screen.queryByRole("alert")).toBeNull();

      fireEvent.blur(screen.getByLabelText("What Kai handles"));

      expect(screen.getByRole("alert").textContent).toBe(
        "Write at least one sentence. Without it, Kai is just Copilot with a face."
      );
      expect(await createButtonHint()).toBe("Write what Kai handles first");
    });

    it(`counts the instruction's characters and turns the count orange past 4,000 without blocking Create (${ISSUE})`, () => {
      renderForm();
      enterName("Kai");

      type("What Kai handles", "x".repeat(4000));
      expect(screen.getByText("4,000 / 4,000").className).toContain("tw-text-faint");

      type("What Kai handles", "x".repeat(4001));
      expect(screen.getByText("4,001 / 4,000").className).toContain("tw-text-warning");
      expect(createButton().disabled).toBe(false);
    });

    it(`keeps everything typed and says why when creating the agent fails (${ISSUE})`, async () => {
      const onCreate = jest
        .fn()
        .mockRejectedValue(new Error("Copilot Teammates is not available."));
      renderForm({ onCreate });
      enterName("Kai");
      type("What Kai handles", "You handle marketing.");

      fireEvent.click(createButton());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Couldn't create Kai. Copilot Teammates is not available."
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

    it(`tells its dialog nothing needs asking while the starting values are untouched, and asks once one is edited (https://github.com/Brevilabs/obsidian-copilot-private/issues/963)`, () => {
      const { closeGuard } = renderForm({
        initialValues: { name: "Coco", title: "", instruction: "You look after my vault." },
      });
      expect(closeGuard.hasInput).toBe(false);

      type(/^Title/, "Runs my week");
      expect(closeGuard).toMatchObject({ hasInput: true, name: "Coco" });
    });

    it(`starts from the values it is given, with the given name in the instruction's label, its hint and the folder at once (${ISSUE})`, () => {
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
      expect(screen.getByText(/Nora reads this at the start of every chat\./)).not.toBeNull();
      expect(screen.getByText("Saved in copilot/teammates/nora/")).not.toBeNull();
      expect(createButton().disabled).toBe(false);
    });

    it(`shows a tip to ask Copilot instead, whose Ask Copilot hands over one sentence asking Copilot to suggest a name, ending where the user describes the agent (${ISSUE})`, () => {
      const onAskCopilot = jest.fn();
      renderForm({ onAskCopilot });

      expect(document.querySelector("form")?.firstElementChild?.textContent).toBe(
        "Tip: you can also just ask. Tell Copilot what you need and it drafts the teammate for you.Ask Copilot"
      );
      fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));

      expect(onAskCopilot).toHaveBeenCalledWith(
        "Create a new teammate for me and suggest a name for it. Here's what it should do: "
      );
    });

    it(`carries the name and instruction the user typed into the message for Copilot, so nothing they wrote is lost (${ISSUE})`, () => {
      const onAskCopilot = jest.fn();
      renderForm({ onAskCopilot });
      type("Name", " Kai ");
      type("What it handles", "You handle marketing.\n");

      fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));

      expect(onAskCopilot).toHaveBeenCalledWith(
        "Create a new teammate named Kai for me. Here's what it should do: You handle marketing."
      );
    });

    it(`asks Copilot to suggest a name ahead of the typed instruction when no name is typed (${ISSUE})`, () => {
      const onAskCopilot = jest.fn();
      renderForm({ onAskCopilot });
      type("What it handles", "You handle marketing.");

      fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));

      expect(onAskCopilot).toHaveBeenCalledWith(
        "Create a new teammate for me and suggest a name for it. Here's what it should do: You handle marketing."
      );
    });

    it(`leaves the values the dialog opened with out of the message for Copilot, as the first agent's template (${ISSUE})`, () => {
      const onAskCopilot = jest.fn();
      renderForm({
        onAskCopilot,
        initialValues: { name: "Coco", title: "", instruction: "You look after my vault." },
      });
      type(/^Title/, "Runs my week");

      fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));

      expect(onAskCopilot).toHaveBeenCalledWith(
        "Create a new teammate for me and suggest a name for it. Here's what it should do: "
      );
    });

    it(`opens a drafted agent with "Drafted by" and the drafting agent's face as its first line, and nothing above the fields otherwise (${DRAFT_ISSUE})`, () => {
      renderForm({
        initialValues: {
          name: "Nora",
          title: "Family logistics",
          instruction: "You plan pickups.",
        },
        draftedBy: { name: "Coco", faceSrc: "app://coco.webp" },
      });

      const banner = document.querySelector("form")?.firstElementChild as HTMLElement;
      expect(banner.textContent).toBe(
        "Drafted by Coco. Check it, pick a face and a model, then create."
      );
      expect(banner.querySelector("img")?.getAttribute("src")).toBe("app://coco.webp");
      expect(screen.queryByText(/^Tip:/)).toBeNull();
      cleanup();

      renderForm();
      expect(screen.queryByText(/Drafted by/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Ask Copilot" })).toBeNull();
    });

    it(`lets the dialog's own checks handle a drafted name already on the team and a drafted empty instruction (${DRAFT_ISSUE})`, async () => {
      renderForm({
        initialValues: { name: "leo", title: "", instruction: "" },
        draftedBy: { name: "Coco", faceSrc: "app://coco.webp" },
      });

      expect(screen.getByText("Leo is already on your team. Pick another name.")).not.toBeNull();
      expect(createButton().disabled).toBe(true);
      type("Name", "Nora");
      expect(await createButtonHint()).toBe("Write what Nora handles first");
    });

    it(`keeps a drafted instruction past 4,000 characters whole and creates it, with the count orange (${DRAFT_ISSUE})`, async () => {
      const long = "Plan pickups. ".repeat(400).trim();
      const { onCreate } = renderForm({
        initialValues: { name: "Nora", title: "", instruction: long },
        draftedBy: { name: "Coco", faceSrc: "app://coco.webp" },
      });

      expect(screen.getByLabelText<HTMLTextAreaElement>("What Nora handles").value).toBe(long);
      expect(screen.getByText("5,599 / 4,000").className).toContain("tw-text-warning");
      fireEvent.click(createButton());

      await waitFor(() =>
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ instruction: long }))
      );
    });
  });
});
