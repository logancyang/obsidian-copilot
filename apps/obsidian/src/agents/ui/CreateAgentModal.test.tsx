import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { FIRST_AGENT_TEMPLATE } from "@/agents/ui/firstAgentTemplate";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";
import { CreateAgentModal } from "@/agents/ui/CreateAgentModal";
import type { FakeObsidianModal } from "@/agents/ui/testing/fakeObsidianModal";
import { LEO } from "@/agents/ui/testing/rosterFixtures";
import { resetSettings } from "@/settings/model";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { PRESET_FACES_URL } from "@/agents/presetFaces";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import * as obsidian from "obsidian";

jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  Modal: jest.requireActual<typeof import("@/agents/ui/testing/fakeObsidianModal")>(
    "@/agents/ui/testing/fakeObsidianModal"
  ).FakeObsidianModal,
}));
jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";
const FIRST_AGENT_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/963";

const requestUrl = jest.fn(() => new Promise(() => {}));
(obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }).__setRequestUrlImpl(
  requestUrl
);

const MODELS: AgentModelChoices = {
  models: [{ name: "opus", displayName: "Opus 5.5", provider: "agent", enabled: true }],
  effortOptionsByModelKey: {},
  initial: { baseModelId: "opus", effort: null },
};

function fakeStore(
  createAgent: CustomAgentStore["createAgent"],
  agents: readonly CustomAgent[] = [LEO]
): CustomAgentStore {
  return {
    subscribe: () => () => {},
    getAgents: () => agents,
    folderNames: () => agents.map((agent) => agent.slug),
    createAgent,
  } as unknown as CustomAgentStore;
}

type OpenedModal = CreateAgentModal & FakeObsidianModal;

const openedModals: OpenedModal[] = [];

function newDialog(
  createAgent = jest.fn().mockResolvedValue("kai"),
  agents?: readonly CustomAgent[],
  onAskCopilot?: jest.Mock
) {
  const onCreated = jest.fn();
  const modal = new CreateAgentModal(createFakeAgentVault().app, {
    store: fakeStore(createAgent, agents),
    models: MODELS,
    onCreated,
    onAskCopilot,
  }) as OpenedModal;
  return { modal, onCreated, createAgent };
}

function openDialog(
  createAgent?: jest.Mock,
  agents?: readonly CustomAgent[],
  onAskCopilot?: jest.Mock
) {
  const dialog = newDialog(createAgent, agents, onAskCopilot);
  act(() => dialog.modal.open());
  openedModals.push(dialog.modal);
  return dialog;
}

function type(label: string | RegExp, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

function enterName(text: string) {
  type("Name", text);
  fireEvent.blur(screen.getByLabelText("Name"));
}

describe("CreateAgentModal", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  });

  beforeEach(async () => {
    resetSettings();
    await setCustomAgentsAccess("team");
  });

  afterEach(() => {
    requestUrl.mockClear();
    act(() => openedModals.splice(0).forEach((modal) => modal.onClose()));
    document.body.innerHTML = "";
  });

  describe("CreateAgentModal", () => {
    describe("open()", () => {
      it("shows the New teammate form saved under the Copilot folder's teammates folder", () => {
        const { modal } = openDialog();

        expect(modal.titleEl.textContent).toBe("New teammate");
        expect(screen.getByLabelText("Name")).not.toBeNull();
        expect(screen.getByText("Saved in copilot/teammates/")).not.toBeNull();
      });

      it(`opens the first agent's dialog filled in as Coco, every field editable and Create available, in a vault with no agents (${FIRST_AGENT_ISSUE})`, () => {
        openDialog(undefined, []);

        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Coco");
        expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe(
          "Chief of staff. Knows the whole vault."
        );
        expect(screen.getByLabelText<HTMLTextAreaElement>("What Coco handles").value).toBe(
          FIRST_AGENT_TEMPLATE.instruction
        );
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Create" }).disabled).toBe(
          false
        );
        type("Name", "Juno");
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Juno");
      });

      it("opens empty in a vault that already has an agent", () => {
        openDialog();

        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
        expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe("");
        expect(screen.getByLabelText<HTMLTextAreaElement>("What it handles").value).toBe("");
      });

      it(`keeps Coco and what the user typed when an agent appears after the dialog opened (${FIRST_AGENT_ISSUE})`, () => {
        let agents: readonly CustomAgent[] = [];
        let notify = () => {};
        const store = {
          subscribe: (listener: () => void) => {
            notify = listener;
            return () => {};
          },
          getAgents: () => agents,
          folderNames: () => agents.map((agent) => agent.slug),
        } as unknown as CustomAgentStore;
        const modal = new CreateAgentModal(createFakeAgentVault().app, {
          store,
          models: MODELS,
          onCreated: jest.fn(),
        }) as OpenedModal;
        act(() => modal.open());
        openedModals.push(modal);
        type(/^Title/, "Runs my week");

        act(() => {
          agents = [LEO];
          notify();
        });

        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Coco");
        expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe("Runs my week");
      });

      it(`opens a drafted agent's values, not Coco's, even in a vault with no agents (${FIRST_AGENT_ISSUE})`, () => {
        const modal = new CreateAgentModal(createFakeAgentVault().app, {
          store: fakeStore(jest.fn(), []),
          models: MODELS,
          initialValues: { name: "Nora", title: "", instruction: "You plan pickups." },
          onCreated: jest.fn(),
        }) as OpenedModal;
        act(() => modal.open());
        openedModals.push(modal);

        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Nora");
        expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe("");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/941 shows a drafted agent's values under a Drafted by line naming the agent that drafted it", () => {
        const modal = new CreateAgentModal(createFakeAgentVault().app, {
          store: fakeStore(jest.fn()),
          models: MODELS,
          initialValues: {
            name: "Nora",
            title: "Family logistics",
            instruction: "You plan pickups.",
          },
          draftedBy: { name: "Coco", faceSrc: "app://coco.webp" },
          onCreated: jest.fn(),
        }) as OpenedModal;
        act(() => modal.open());
        openedModals.push(modal);

        expect(screen.getByText("Drafted by Coco.")).not.toBeNull();
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Nora");
        expect(screen.getByLabelText<HTMLTextAreaElement>("What Nora handles").value).toBe(
          "You plan pickups."
        );
      });

      it(`downloads nothing from the CDN until the dialog opens, then the preset face list (${ISSUE})`, async () => {
        requestUrl.mockRejectedValueOnce(new Error("Request failed, status 404"));
        const { modal } = newDialog();
        expect(requestUrl).not.toHaveBeenCalled();

        act(() => modal.open());
        openedModals.push(modal);

        expect(requestUrl).toHaveBeenCalledWith({ url: PRESET_FACES_URL });
        fireEvent.click(screen.getByRole("button", { name: "Change face" }));
        expect(
          await screen.findByText("Couldn't load the preset faces. You can upload an image.")
        ).not.toBeNull();
      });
    });

    describe("close()", () => {
      it.each([
        ["a click outside", (modal: OpenedModal) => fireEvent.click(modal.bgEl)],
        ["Esc", (modal: OpenedModal) => modal.pressEscape()],
        ["the close button", (modal: OpenedModal) => fireEvent.click(modal.closeButtonEl)],
        ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
      ])("closes at once on %s while nothing is typed", (_how, dismiss) => {
        const { modal } = openDialog();

        act(() => void dismiss(modal));

        expect(modal.isOpen).toBe(false);
      });

      it(`stays open on a click outside once text is typed (${ISSUE})`, () => {
        const { modal } = openDialog();
        type("Name", "Kai");

        fireEvent.click(modal.bgEl);

        expect(modal.isOpen).toBe(true);
        expect(screen.queryByText("Discard Kai?")).toBeNull();
      });

      it.each([
        ["Esc", (modal: OpenedModal) => modal.pressEscape()],
        ["the close button", (modal: OpenedModal) => fireEvent.click(modal.closeButtonEl)],
        ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
      ])(
        `asks before discarding typed text on %s, and closes on Discard (${ISSUE})`,
        (_how, dismiss) => {
          const { modal } = openDialog();
          type("What it handles", "You handle marketing.");

          act(() => void dismiss(modal));
          expect(modal.isOpen).toBe(true);
          expect(screen.getByText("Discard this teammate?")).not.toBeNull();

          fireEvent.click(screen.getByRole("button", { name: "Discard" }));
          expect(modal.isOpen).toBe(false);
        }
      );

      it.each([
        ["a click outside", (modal: OpenedModal) => fireEvent.click(modal.bgEl)],
        ["Esc", (modal: OpenedModal) => modal.pressEscape()],
        ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
      ])(
        `closes the first agent's untouched dialog at once on %s, since it holds nothing the user wrote (${FIRST_AGENT_ISSUE})`,
        (_how, dismiss) => {
          const { modal } = openDialog(undefined, []);

          act(() => void dismiss(modal));

          expect(modal.isOpen).toBe(false);
        }
      );

      it(`asks before discarding the first agent's dialog once a field is edited (${FIRST_AGENT_ISSUE})`, () => {
        const { modal } = openDialog(undefined, []);
        type(/^Title/, "Runs my week");

        act(() => void modal.pressEscape());

        expect(modal.isOpen).toBe(true);
        expect(screen.getByText("Discard Coco?")).not.toBeNull();
      });

      it(`closes at once on Ask Copilot while nothing is typed, then hands Copilot the message (${ISSUE})`, () => {
        const onAskCopilot = jest.fn();
        const { modal } = openDialog(undefined, undefined, onAskCopilot);

        fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));

        expect(modal.isOpen).toBe(false);
        expect(onAskCopilot).toHaveBeenCalledWith(
          "Create a new teammate for me and suggest a name for it. Here's what it should do: "
        );
      });

      it(`asks before discarding typed text on Ask Copilot: Discard closes and hands Copilot the typed name, Keep editing stays and hands nothing (${ISSUE})`, () => {
        const onAskCopilot = jest.fn();
        const { modal } = openDialog(undefined, undefined, onAskCopilot);
        type("Name", "Kai");

        fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));
        fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
        expect(modal.isOpen).toBe(true);
        act(() => void modal.pressEscape());
        fireEvent.click(screen.getByRole("button", { name: "Discard" }));
        expect(onAskCopilot).not.toHaveBeenCalled();

        openDialog(undefined, undefined, onAskCopilot);
        type("Name", "Kai");
        fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));
        fireEvent.click(screen.getByRole("button", { name: "Discard" }));
        expect(onAskCopilot).toHaveBeenCalledWith(
          "Create a new teammate named Kai for me. Here's what it should do: "
        );
      });

      it(`keeps the dialog and everything typed when the user chooses Keep editing (${ISSUE})`, () => {
        const { modal } = openDialog();
        type("Name", "Kai");

        act(() => void modal.pressEscape());
        fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

        expect(screen.queryByText("Discard Kai?")).toBeNull();
        expect(modal.isOpen).toBe(true);
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Kai");
      });
    });

    describe("onEscapeKey()", () => {
      it(`leaves Esc to an open face picker instead of closing or asking (${ISSUE})`, async () => {
        const { modal } = openDialog();
        type("Name", "Kai");
        fireEvent.click(screen.getByRole("button", { name: "Change face" }));
        await screen.findByRole("button", { name: /Upload image/ });

        const escape = modal.pressEscape();

        expect(escape.defaultPrevented).toBe(false);
        expect(modal.isOpen).toBe(true);
        expect(screen.queryByText("Discard Kai?")).toBeNull();
      });

      it(`asks on Esc while a picker is still fading out after closing (${ISSUE})`, () => {
        const { modal } = openDialog();
        type("Name", "Kai");
        const closing = modal.modalEl.createDiv({
          attr: { "data-radix-popper-content-wrapper": "" },
        });
        closing.createDiv({ attr: { "data-state": "closed" } });

        act(() => void modal.pressEscape());

        expect(screen.getByText("Discard Kai?")).not.toBeNull();
      });
    });

    describe("onOpen()", () => {
      it(`creates the agent in the store, closes, and hands back its folder name so the home selects it (${ISSUE})`, async () => {
        const { modal, onCreated, createAgent } = openDialog();
        enterName("Kai");
        type("What Kai handles", "You handle marketing.");

        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith("kai"));
        expect(createAgent).toHaveBeenCalledWith({
          name: "Kai",
          title: "",
          model: { baseModelId: "opus", effort: null },
          instruction: "You handle marketing.",
          face: undefined,
        });
        expect(modal.isOpen).toBe(false);
      });

      it(`creates Coco on the default model and effort without any typing in a vault with no agents (${FIRST_AGENT_ISSUE})`, async () => {
        const { onCreated, createAgent } = openDialog(jest.fn().mockResolvedValue("coco"), []);

        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith("coco"));
        expect(createAgent).toHaveBeenCalledWith({
          ...FIRST_AGENT_TEMPLATE,
          model: MODELS.initial,
          face: undefined,
        });
      });

      it(`stays open with everything typed when the store cannot create the agent (${ISSUE})`, async () => {
        const { modal, onCreated } = openDialog(
          jest.fn().mockRejectedValue(new Error("Copilot Teammates is not available."))
        );
        enterName("Kai");
        type("What Kai handles", "You handle marketing.");

        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        expect((await screen.findByRole("alert")).textContent).toContain("Couldn't create Kai.");
        expect(modal.isOpen).toBe(true);
        expect(onCreated).not.toHaveBeenCalled();
      });
    });
  });
});
