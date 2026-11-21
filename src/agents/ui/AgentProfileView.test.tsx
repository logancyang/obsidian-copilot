import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFacePicker } from "@/agents/ui/AgentFacePicker";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";
import {
  AgentProfileView,
  countOf,
  type AgentProfileFacts,
  type AgentProfileViewProps,
} from "@/agents/ui/AgentProfileView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";
const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const SETUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";

const NOW = new Date(2026, 10, 16, 15, 20).getTime();

function agent(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "coco",
    name: "Coco",
    title: "Keeps the whole vault in view",
    instruction: "You keep the whole vault in view. Answer briefly.",
    faceSrc: "face:coco",
    instructionsPath: "copilot/teammates/coco/instructions.md",
    memoryPath: "copilot/teammates/coco/MEMORY.md",
    ...overrides,
  } as CustomAgent;
}

const FACTS: AgentProfileFacts = {
  chatCount: 23,
  createdAt: new Date(2026, 9, 3, 9, 0).getTime(),
  editedAt: new Date(2026, 10, 2, 17, 45).getTime(),
  memory: { rules: 9, changedAt: new Date(2026, 10, 16, 14, 31).getTime() },
};

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

const PRESET_BYTES = new Uint8Array([7]).buffer;

function renderProfile(props: Partial<AgentProfileViewProps> = {}) {
  const handlers = {
    onBack: jest.fn(),
    onNewChat: jest.fn(),
    onOpenFile: jest.fn(),
    onRename: jest.fn().mockResolvedValue(undefined),
    onRetitle: jest.fn().mockResolvedValue(undefined),
    onChangeFace: jest.fn(),
    onChangeModel: jest.fn(),
    onDelete: jest.fn(),
  };
  render(
    <TooltipProvider>
      <AgentProfileView
        agent={agent()}
        facts={FACTS}
        now={NOW}
        otherAgents={[agent(), agent({ slug: "maya", name: "Maya" })]}
        models={MODELS}
        renderFacePicker={(onPick) => (
          <AgentFacePicker
            presets={{
              status: "ready",
              faces: [{ id: "leo", alt: "Leo's face", bytes: PRESET_BYTES, src: "face:leo" }],
              usedIds: new Set(),
            }}
            onPick={onPick}
          />
        )}
        {...handlers}
        {...props}
      />
    </TooltipProvider>
  );
  return handlers;
}

function startEditing(button: string): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: button }));
  return screen.getByRole<HTMLInputElement>("textbox");
}

describe("AgentProfileView", () => {
  beforeAll(() => {
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });

  describe("AgentProfileView()", () => {
    it("shows the agent's face, name, title, how many chats it has had and since when", () => {
      renderProfile();

      expect(screen.getByRole("img", { hidden: true }).getAttribute("src")).toBe("face:coco");
      expect(screen.getByText("Coco")).not.toBeNull();
      expect(screen.getByText("Keeps the whole vault in view")).not.toBeNull();
      expect(screen.getByText("23 chats · since Oct 3")).not.toBeNull();
    });

    it(`draws the agent's big face without the accent ring that marks a picked face, since the profile shows one agent (${ISSUE})`, () => {
      renderProfile();
      expect(screen.getByRole("img", { hidden: true }).className).not.toContain("tw-outline");

      document.body.innerHTML = "";
      renderProfile({ locked: { onUnlock: jest.fn() } });
      expect(screen.getAllByRole("img", { hidden: true })[0].className).not.toContain("tw-outline");
    });

    it(`slides in from the right with a fade as it opens, the way an asked agent's conversation does, and holds still when the system asks for reduced motion (${ISSUE})`, () => {
      renderProfile();

      const page = screen.getByRole("button", { name: "Back to chat" }).closest(".tw-size-full");
      expect(page?.className.split(" ")).toEqual(
        expect.arrayContaining([
          "tw-duration-300",
          "tw-ease-out",
          "tw-animate-in",
          "tw-fade-in-25",
          "tw-slide-in-from-right-1/4",
          "motion-reduce:tw-animate-none",
        ])
      );
    });

    it("names the page by the agent and its sections by what they hold, as headings", () => {
      renderProfile();

      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Coco");
      expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
        "What Coco knows",
        "Model",
      ]);
    });

    it("counts one chat in the singular and a first day as today", () => {
      renderProfile({ facts: { ...FACTS, chatCount: 1, createdAt: NOW - 60_000 } });

      expect(screen.getByText("1 chat · since today")).not.toBeNull();
    });

    it("names the year of a start date from another year and leaves the count out until it loads", () => {
      renderProfile({
        facts: { ...FACTS, chatCount: null, createdAt: new Date(2025, 0, 9).getTime() },
      });

      expect(screen.getByText("since Jan 9, 2025")).not.toBeNull();
    });

    it(`shows the instruction's first sentence when the agent has no title (${ISSUE})`, () => {
      renderProfile({ agent: agent({ title: "" }) });

      expect(screen.getByText("You keep the whole vault in view.")).not.toBeNull();
    });

    it("shows what the agent handles, who writes it and when it was last edited, and opens instructions.md", () => {
      const { onOpenFile } = renderProfile();

      const row = screen.getByRole("button", { name: /What Coco handles/ });
      expect(row.textContent).toContain("Instruction · you write this · edited Nov 2");
      fireEvent.click(row);

      expect(onOpenFile).toHaveBeenCalledWith("copilot/teammates/coco/instructions.md");
    });

    it("says an instruction not edited since the day it was made was written then", () => {
      renderProfile({ facts: { ...FACTS, createdAt: NOW - 3_600_000, editedAt: NOW - 60_000 } });

      expect(screen.getByText("Instruction · you write this · written today")).not.toBeNull();
    });

    it(`notes in orange that an instruction past 4,000 characters is longer than the agent follows well (${ISSUE})`, () => {
      renderProfile({ agent: agent({ instruction: "x".repeat(4620) }) });

      const note = screen.getByText(
        "Instruction · 4,620 characters · longer than Coco follows well"
      );
      expect(note.className).toContain("tw-text-warning");
    });

    it("counts only the instruction's text, without the whitespace around it", () => {
      renderProfile({ agent: agent({ instruction: `\n${"x".repeat(4001)}\n\n` }) });

      expect(
        screen.getByText("Instruction · 4,001 characters · longer than Coco follows well")
      ).not.toBeNull();
    });

    it("keeps an instruction of exactly 4,000 characters in the normal note", () => {
      renderProfile({ agent: agent({ instruction: "x".repeat(4000) }) });

      expect(
        screen.getByText("Instruction · you write this · edited Nov 2").className
      ).not.toContain("tw-text-warning");
    });

    it("shows the rules the agent remembers with their count and today's last change, and opens MEMORY.md", () => {
      const { onOpenFile } = renderProfile();

      const row = screen.getByRole("button", { name: /Rules Coco remembers/ });
      expect(row.textContent).toContain("Memory · Coco adds to this · 9 rules · today 14:31");
      fireEvent.click(row);

      expect(onOpenFile).toHaveBeenCalledWith("copilot/teammates/coco/MEMORY.md");
    });

    it("dates a memory change from an earlier day by its day and counts one rule in the singular", () => {
      renderProfile({
        facts: {
          ...FACTS,
          memory: { rules: 1, changedAt: new Date(2026, 10, 12, 8, 5).getTime() },
        },
      });

      expect(screen.getByText("Memory · Coco adds to this · 1 rule · Nov 12")).not.toBeNull();
    });

    it(`says a new agent has saved nothing yet, with no Open, while MEMORY.md does not exist (${ISSUE})`, () => {
      renderProfile({ agent: agent({ name: "Kai" }), facts: { ...FACTS, memory: null } });

      expect(screen.queryByRole("button", { name: /Rules Kai remembers/ })).toBeNull();
      expect(
        screen.getByText(
          "Nothing yet. Kai adds a rule when you correct it or ask it to remember something."
        )
      ).not.toBeNull();
      expect(screen.getAllByText("Open")).toHaveLength(1);
    });

    it("starts a new chat with the agent", () => {
      const { onNewChat } = renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "New chat with Coco" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
    });

    it(`goes back to the chat from Back or Esc (${ISSUE})`, () => {
      const { onBack } = renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      fireEvent.keyDown(screen.getByRole("button", { name: "New chat with Coco" }), {
        key: "Escape",
      });

      expect(onBack).toHaveBeenCalledTimes(2);
    });

    it("puts the keyboard on Back when the profile opens", () => {
      renderProfile();

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to chat" }));
    });

    it(`renames the agent in place on Enter (${ISSUE})`, async () => {
      const { onRename } = renderProfile();

      const input = startEditing("Rename Coco");
      expect(input.value).toBe("Coco");
      expect(screen.getByText("Enter to save · Esc to cancel")).not.toBeNull();
      fireEvent.change(input, { target: { value: " Cocoa " } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(onRename).toHaveBeenCalledWith("Cocoa");
    });

    it("saves the new name when the user clicks elsewhere", async () => {
      const { onRename } = renderProfile();

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "Cocoa" } });
      fireEvent.blur(input);

      await waitFor(() => expect(onRename).toHaveBeenCalledWith("Cocoa"));
    });

    it(`refuses a name already on the team, in any case, the way the create dialog does (${ISSUE})`, async () => {
      const { onRename } = renderProfile();

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "maya" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(
        await screen.findByText("Maya is already on your team. Pick another name.")
      ).not.toBeNull();
      expect(screen.getByRole("textbox")).toBe(input);
      expect(onRename).not.toHaveBeenCalled();
    });

    it("keeps the agent's own name in another case, which is no clash", async () => {
      const { onRename } = renderProfile();

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "COCO" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(onRename).toHaveBeenCalledWith("COCO"));
    });

    it(`shows each edit pencil while the pointer is over the head or its own control has keyboard focus, not while focus a click left sits in the head (${ISSUE})`, () => {
      renderProfile();

      for (const name of ["Change Coco's face", "Rename Coco", "Change Coco's title"]) {
        const pencil = screen
          .getByRole("button", { name })
          .querySelector(".lucide-pencil")?.parentElement;
        expect(pencil?.className.split(" ")).toEqual(
          expect.arrayContaining([
            "tw-opacity-0",
            "group-hover:tw-opacity-100",
            "[:focus-visible>&]:tw-opacity-100",
          ])
        );
        expect(pencil?.className).not.toContain("focus-within");
      }
    });

    it(`hands focus back to the name without the keyboard focus look after an edit started with a click, and with it after one started from the keyboard (${ISSUE})`, async () => {
      const focus = jest.spyOn(HTMLElement.prototype, "focus");
      renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "Rename Coco" }), { detail: 1 });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Coco" }));
      expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });

      fireEvent.click(screen.getByRole("button", { name: "Rename Coco" }), { detail: 0 });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cocoa" } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(focus).toHaveBeenLastCalledWith({ focusVisible: true });
      focus.mockRestore();
    });

    it(`cancels a rename on Esc without leaving the profile (${ISSUE})`, () => {
      const { onRename, onBack } = renderProfile();

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "Cocoa" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByRole("textbox")).toBeNull();
      expect(onRename).not.toHaveBeenCalled();
      expect(onBack).not.toHaveBeenCalled();
    });

    it(`keeps the name when the new one is empty (${ISSUE})`, async () => {
      const { onRename } = renderProfile();

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(onRename).not.toHaveBeenCalled();
    });

    it(`says what to fix and keeps the typed name when the instructions file cannot be saved (${ISSUE})`, async () => {
      const onRename = jest.fn().mockRejectedValue(new Error("YAMLParseError: bad indentation"));
      renderProfile({ onRename });

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "Cocoa" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(
        await screen.findByText(
          "Couldn't save. Fix the properties at the top of Coco's instructions.md first."
        )
      ).not.toBeNull();
      expect(input.value).toBe("Cocoa");
    });

    it("changes the title in place, starting from the title as written", async () => {
      const { onRetitle } = renderProfile();

      const input = startEditing("Change Coco's title");
      expect(input.value).toBe("Keeps the whole vault in view");
      fireEvent.change(input, { target: { value: "Keeps the vault tidy" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(onRetitle).toHaveBeenCalledWith("Keeps the vault tidy"));
    });

    it(`saves an emptied title, so the instruction's first sentence shows in its place (${ISSUE})`, async () => {
      const { onRetitle } = renderProfile();

      const input = startEditing("Change Coco's title");
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(onRetitle).toHaveBeenCalledWith(""));
    });

    it("starts an untitled agent's title edit empty, not from the first sentence shown", () => {
      renderProfile({ agent: agent({ title: "" }) });

      expect(startEditing("Change Coco's title").value).toBe("");
    });

    it(`changes the face from the same picker as the create dialog and closes it (${ISSUE})`, async () => {
      const { onChangeFace } = renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "Change Coco's face" }));
      fireEvent.click(await screen.findByRole("button", { name: "Leo's face" }));

      expect(onChangeFace).toHaveBeenCalledWith({ kind: "preset", bytes: PRESET_BYTES });
      await waitFor(() => expect(screen.queryByText("Pick a face")).toBeNull());
    });

    it("shows the agent's model, or the default model for an agent that has none", () => {
      renderProfile({ agent: agent({ model: { baseModelId: "sonnet", effort: "medium" } }) });
      expect(screen.getByTitle("Model · effort").textContent).toContain("Sonnet 5.5");

      document.body.innerHTML = "";
      renderProfile({ agent: agent({ model: null }) });
      expect(screen.getByTitle("Model · effort").textContent).toContain("Opus 5.5");
    });

    it(`sets the model future chats start on from the model list (${ISSUE})`, async () => {
      const { onChangeModel, onBack } = renderProfile();

      fireEvent.click(screen.getByTitle("Model · effort"));
      const sonnet = await screen.findByRole("option", { name: /Sonnet 5\.5/ });
      fireEvent.click(sonnet);
      fireEvent.keyDown(sonnet, { key: "Escape" });

      await waitFor(() =>
        expect(onChangeModel).toHaveBeenCalledWith({ baseModelId: "sonnet", effort: "low" })
      );
      expect(onBack).not.toHaveBeenCalled();
    });

    it("asks to delete the agent from the red button at the bottom", () => {
      const { onDelete } = renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "Delete Coco…" }));

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it(`shows a locked agent read-only under its valid Supporter license banner: a greyed face, plain name and title, both files to open, a greyed Model row, and Delete as the only action (${LOCKED_ISSUE})`, () => {
      const onUnlock = jest.fn();
      const { onOpenFile, onDelete } = renderProfile({ locked: { onUnlock } });

      expect(screen.getByText("Coco can't chat without a valid Supporter license.")).not.toBeNull();
      const face = screen.getAllByRole("img", { hidden: true })[0];
      expect(face.className).toContain("tw-grayscale");
      expect(face.parentElement?.querySelector(".lucide-lock")).not.toBeNull();
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Coco");
      expect(screen.getByText("Keeps the whole vault in view")).not.toBeNull();
      expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
        "What Coco knows",
        "Model",
      ]);
      expect(
        screen.getByText("Locked until you enter a valid Supporter license key")
      ).not.toBeNull();
      expect(screen.getByTitle("Model · effort").hasAttribute("disabled")).toBe(true);
      expect(
        screen
          .getAllByRole("button")
          .filter((button) => !button.hasAttribute("disabled"))
          .map((button) => button.textContent)
      ).toEqual([
        "Back to chat",
        "Enter license key",
        expect.stringContaining("What Coco handles"),
        expect.stringContaining("Rules Coco remembers"),
        "Delete Coco…",
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));
      fireEvent.click(screen.getByRole("button", { name: /Rules Coco remembers/ }));
      fireEvent.click(screen.getByRole("button", { name: "Delete Coco…" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
      expect(onOpenFile).toHaveBeenCalledWith("copilot/teammates/coco/MEMORY.md");
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it(`shows a setup-locked agent's reason under the header, marks the Model field with what to do, and turns New chat off with the reason as its tooltip (${SETUP_ISSUE})`, async () => {
      const reason = "Coco runs on OpenCode, which isn't set up on this device.";
      const open = jest.fn();
      const { onNewChat } = renderProfile({
        setupLocked: { reason, setUp: { label: "Set up OpenCode", open } },
      });

      expect(screen.getByText(reason)).not.toBeNull();
      expect(screen.getByRole("alert").textContent).toBe("Pick a model that runs on this device.");
      expect(screen.getByTitle("Model · effort").hasAttribute("disabled")).toBe(false);
      expect(screen.getByRole("button", { name: "Rename Coco" })).not.toBeNull();
      const newChat = screen.getByRole("button", { name: "New chat with Coco" });
      expect(newChat.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(newChat);
      fireEvent.click(screen.getByRole("button", { name: "Set up OpenCode" }));
      fireEvent.focus(newChat);

      expect(onNewChat).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
      expect((await screen.findByRole("tooltip")).textContent).toBe(reason);
    });

    it(`shows the license banner, not the setup reason, when both lock the agent (${SETUP_ISSUE})`, () => {
      renderProfile({
        locked: { onUnlock: jest.fn() },
        setupLocked: { reason: "Coco's model, gpt-6, isn't available on this device." },
      });

      expect(screen.getByText("Coco can't chat without a valid Supporter license.")).not.toBeNull();
      expect(screen.queryByText(/isn't available on this device/)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("countOf()", () => {
    it("counts in the singular for one and in the plural with thousands separators otherwise", () => {
      expect([countOf(1, "rule"), countOf(0, "chat"), countOf(4620, "character")]).toEqual([
        "1 rule",
        "0 chats",
        "4,620 characters",
      ]);
    });
  });
});
