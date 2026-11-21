import {
  customAgentsFolderPath,
  CustomAgentStore,
  runCustomAgentStoreWhileEnabled,
} from "@/agents/CustomAgentStore";
import { NEUTRAL_FACE_SRC, serializeInstructionsFile } from "@/agents/customAgentFiles";
import { setCustomAgentsAccess, verifyStoredToken } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { installFakeFaceCanvas } from "@/agents/testing/fakeFaceCanvas";
import { setSettings } from "@/settings/model";
import { getFrontMatterInfo, parseYaml } from "obsidian";

jest.mock("@/entitlement");

const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const SONNET = { baseModelId: "claude-sonnet-4-5", effort: "medium" };

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function seedAgent(
  vault: FakeAgentVault,
  slug: string,
  name: string,
  { instruction = `${name} handles things.`, withFace = true, folder = "copilot/teammates" } = {}
): void {
  vault.writeByHand(
    `${folder}/${slug}/instructions.md`,
    serializeInstructionsFile({ name, title: `${name}'s title`, model: SONNET }, instruction)
  );
  if (withFace) vault.writeByHand(`${folder}/${slug}/face.webp`, bytes(1, 2, 3));
}

function holdUploadDecoding(): () => void {
  installFakeFaceCanvas({ uploadWidth: 300, uploadHeight: 200 });
  let release: () => void = () => {};
  const bitmap = { width: 300, height: 200, close: jest.fn() };
  Object.assign(window, {
    createImageBitmap: () => new Promise((resolve) => (release = () => resolve(bitmap))),
  });
  return () => release();
}

function nextChange(store: CustomAgentStore): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

describe("CustomAgentStore", () => {
  let vault: FakeAgentVault;
  let store: CustomAgentStore;

  beforeEach(async () => {
    setSettings({ copilotFolder: "copilot" });
    await setCustomAgentsAccess("team");
    vault = createFakeAgentVault();
    store = new CustomAgentStore(vault.app);
  });

  afterEach(() => {
    store.stop();
    jest.restoreAllMocks();
  });

  describe("CustomAgentStore", () => {
    describe("start()", () => {
      it("lists every agent folder holding instructions.md by name, with its properties, instruction and face", async () => {
        seedAgent(vault, "maya", "Maya");
        seedAgent(vault, "coco", "Coco", { instruction: "Keep the vault in view." });

        await store.start();

        expect(store.getAgents()).toEqual([
          {
            slug: "coco",
            name: "Coco",
            title: "Coco's title",
            model: SONNET,
            instruction: "Keep the vault in view.",
            folderPath: "copilot/teammates/coco",
            instructionsPath: "copilot/teammates/coco/instructions.md",
            memoryPath: "copilot/teammates/coco/MEMORY.md",
            facePath: "copilot/teammates/coco/face.webp",
            faceSrc: "app://vault/copilot/teammates/coco/face.webp?4",
          },
          expect.objectContaining({ slug: "maya", name: "Maya" }),
        ]);
      });

      it("shows the neutral placeholder face for an agent whose face.webp is missing", async () => {
        seedAgent(vault, "kai", "Kai", { withFace: false });

        await store.start();

        expect(store.getAgents()[0].faceSrc).toBe(NEUTRAL_FACE_SRC);
      });

      it("skips a folder without instructions.md, such as one Sync has not finished", async () => {
        seedAgent(vault, "coco", "Coco");
        vault.writeByHand("copilot/teammates/half-synced/face.webp", bytes(9));

        await store.start();

        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["coco"]);
      });

      it("lists the other agents when one instructions.md cannot be read, such as one Sync removes mid-scan (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", async () => {
        seedAgent(vault, "coco", "Coco");
        seedAgent(vault, "maya", "Maya");
        jest
          .spyOn(vault.app.vault, "read")
          .mockImplementation((file) =>
            file.path.includes("/coco/")
              ? Promise.reject(new Error("ENOENT"))
              : Promise.resolve(vault.readText(file.path) ?? "")
          );

        await store.start();

        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["maya"]);
      });

      it("lists agents in numbered folders or with the same name as two separate agents, as earlier builds and hand-made folders leave them", async () => {
        seedAgent(vault, "coco", "Coco");
        seedAgent(vault, "coco-2", "Coco");

        await store.start();

        expect(store.getAgents().map((agent) => [agent.slug, agent.name])).toEqual([
          ["coco", "Coco"],
          ["coco-2", "Coco"],
        ]);
      });

      it("names an agent after its folder when instructions.md has no name (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", async () => {
        vault.writeByHand("copilot/teammates/leo/instructions.md", "Keep the books.");

        await store.start();

        expect(store.getAgents()[0]).toMatchObject({ name: "leo", instruction: "Keep the books." });
      });

      it("reads the teammates folder under the Copilot folder from settings", async () => {
        setSettings({ copilotFolder: "ai/assistant" });
        seedAgent(vault, "coco", "Coco", { folder: "ai/assistant/teammates" });
        seedAgent(vault, "maya", "Maya", { folder: "copilot/teammates" });

        await store.start();

        expect(store.getAgents().map((agent) => agent.folderPath)).toEqual([
          "ai/assistant/teammates/coco",
        ]);
      });

      it("picks up instructions.md edited by hand without a reload", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();

        const changed = nextChange(store);
        vault.writeByHand(
          "copilot/teammates/coco/instructions.md",
          "---\nname: Coco Bean\n---\nNew instruction."
        );
        await changed;

        expect(store.getAgents()[0]).toMatchObject({
          slug: "coco",
          name: "Coco Bean",
          instruction: "New instruction.",
        });
      });

      it("picks up an agent folder Sync adds and one the file explorer deletes", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();

        const added = nextChange(store);
        seedAgent(vault, "maya", "Maya");
        await added;
        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["coco", "maya"]);

        const deleted = nextChange(store);
        vault.deleteByHand("copilot/teammates/coco");
        await deleted;
        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["maya"]);
      });
    });

    describe("stop()", () => {
      it("empties the list and stops following edits in the teammates folder", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();
        const listener = jest.fn();
        store.subscribe(listener);

        store.stop();
        seedAgent(vault, "maya", "Maya");

        expect(store.getAgents()).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("settles a scan in flight without listing or rereading the folder when the license is lost mid-scan (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", async () => {
        seedAgent(vault, "coco", "Coco");
        let finishRead: (text: string) => void = () => {};
        jest
          .spyOn(vault.app.vault, "read")
          .mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
        const scan = store.start();
        seedAgent(vault, "maya", "Maya");

        store.stop();
        finishRead("---\nname: Coco\n---\nBody");

        await expect(scan).resolves.toBeUndefined();
        expect(store.getAgents()).toEqual([]);
      });
    });

    describe("getAgents()", () => {
      it("returns one frozen empty list while nothing is listed", async () => {
        const beforeStart = store.getAgents();
        await store.start();

        expect(store.getAgents()).toBe(beforeStart);
        expect(Object.isFrozen(beforeStart)).toBe(true);
      });

      it("keeps the same list when a rescan finds nothing changed, such as a MEMORY.md save, so React does not rerender", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();
        const listed = store.getAgents();

        vault.writeByHand("copilot/teammates/coco/MEMORY.md", "## How to work\n");
        await store.start();

        expect(store.getAgents()).toBe(listed);
      });
    });

    describe("createAgent()", () => {
      it("writes instructions.md and face.webp in a folder named by the slug, and no MEMORY.md", async () => {
        await store.start();

        const slug = await store.createAgent({
          name: "Kai",
          title: "Writes launch posts",
          model: SONNET,
          instruction: "You handle marketing.",
          face: { kind: "preset", bytes: bytes(7, 8, 9) },
        });

        expect(vault.listPaths()).toEqual([
          "copilot/teammates/kai/face.webp",
          "copilot/teammates/kai/instructions.md",
        ]);
        expect(vault.readText("copilot/teammates/kai/instructions.md")).toBe(
          serializeInstructionsFile(
            { name: "Kai", title: "Writes launch posts", model: SONNET },
            "You handle marketing."
          )
        );
        expect(slug).toBe("kai");
        expect(store.getAgents()).toEqual([
          expect.objectContaining({ slug: "kai", name: "Kai", model: SONNET }),
        ]);
      });

      it("refuses a name already on the team in any case and writes nothing", async () => {
        seedAgent(vault, "kai", "Kai");
        await store.start();

        await expect(
          store.createAgent({ name: " KAI ", title: "", model: null, instruction: "Second Kai." })
        ).rejects.toThrow("Kai is already on your team. Pick another name.");
        expect(vault.listPaths()).toEqual([
          "copilot/teammates/kai/face.webp",
          "copilot/teammates/kai/instructions.md",
        ]);
      });

      it("refuses a name whose folder an agent renamed since already uses, and writes nothing (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", async () => {
        seedAgent(vault, "coco", "Chief");
        await store.start();

        await expect(
          store.createAgent({ name: "Coco", title: "", model: null, instruction: "New Coco." })
        ).rejects.toThrow("Chief already uses the folder coco. Pick another name.");
        expect(vault.readText("copilot/teammates/coco/instructions.md")).toContain("name: Chief");
      });

      it("writes nothing when an uploaded face cannot be encoded, so no half-made agent appears", async () => {
        await store.start();
        installFakeFaceCanvas({ uploadWidth: 10, uploadHeight: 10, encoded: null });

        await expect(
          store.createAgent({
            name: "Kai",
            title: "",
            model: null,
            instruction: "x",
            face: { kind: "upload", image: new Blob(["broken"]) },
          })
        ).rejects.toThrow("Could not encode the image.");
        expect(vault.listPaths()).toEqual([]);
      });

      it("writes nothing when the license loses custom agents while an upload is still encoding (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", async () => {
        await store.start();
        const release = holdUploadDecoding();
        const created = store.createAgent({
          name: "Late",
          title: "",
          model: null,
          instruction: "x",
          face: { kind: "upload", image: new Blob(["photo"]) },
        });

        store.stop();
        release();

        await expect(created).rejects.toThrow("Copilot Teammates is not available.");
        expect(vault.listPaths()).toEqual([]);
      });

      it(`refuses while custom agents are locked and writes nothing, so a locked vault's agents stay as they are (${LOCKED_ISSUE})`, async () => {
        seedAgent(vault, "coco", "Coco");
        await setCustomAgentsAccess("keyless");
        await store.start();
        const before = vault.listPaths();

        await expect(
          store.createAgent({ name: "Kai", title: "", model: null, instruction: "x" })
        ).rejects.toThrow("Copilot Teammates is locked.");

        expect(vault.listPaths()).toEqual(before);
      });

      it("writes no face file when created without a face, so the agent shows the placeholder", async () => {
        await store.start();

        await store.createAgent({
          name: "Nora",
          title: "",
          model: null,
          instruction: "Plans trips.",
        });

        expect(vault.listPaths()).toEqual(["copilot/teammates/nora/instructions.md"]);
        expect(store.getAgents()[0].faceSrc).toBe(NEUTRAL_FACE_SRC);
      });
    });

    describe("folderNames()", () => {
      it("lists every name in the teammates folder, including one that holds no agent", async () => {
        seedAgent(vault, "coco", "Coco");
        vault.writeByHand("copilot/teammates/half-synced/face.webp", bytes(9));
        await store.start();

        expect(store.folderNames().sort()).toEqual(["coco", "half-synced"]);
      });

      it("lists nothing before the first agent makes the teammates folder", async () => {
        await store.start();

        expect(store.folderNames()).toEqual([]);
      });
    });

    describe("updateAgent()", () => {
      it("renames the agent and keeps its folder, slug and instruction", async () => {
        seedAgent(vault, "coco", "Coco", { instruction: "Keep the vault in view." });
        await store.start();

        await store.updateAgent("coco", { name: "Bean" });

        expect(vault.listPaths()).toEqual([
          "copilot/teammates/coco/face.webp",
          "copilot/teammates/coco/instructions.md",
        ]);
        expect(store.getAgents()[0]).toMatchObject({
          slug: "coco",
          name: "Bean",
          title: "Coco's title",
          instruction: "Keep the vault in view.",
        });
      });

      it("changes the title and model and keeps properties the user added by hand", async () => {
        vault.writeByHand(
          "copilot/teammates/coco/instructions.md",
          "---\nname: Coco\ntags: [team]\n---\nBody"
        );
        await store.start();

        await store.updateAgent("coco", {
          title: "Keeps the vault in view",
          model: { baseModelId: "gpt-5.5", effort: "high" },
        });

        const written = vault.readText("copilot/teammates/coco/instructions.md")!;
        const info = getFrontMatterInfo(written);
        expect(parseYaml(info.frontmatter)).toEqual({
          name: "Coco",
          tags: ["team"],
          title: "Keeps the vault in view",
          model: '{"baseModelId":"gpt-5.5","effort":"high"}',
        });
        expect(written.slice(info.contentStart)).toBe("Body");
        expect(store.getAgents()[0].model).toEqual({ baseModelId: "gpt-5.5", effort: "high" });
      });

      it("rejects for an agent whose folder is gone, so the profile can report it", async () => {
        await store.start();

        await expect(store.updateAgent("coco", { name: "Bean" })).rejects.toThrow(
          "No agent at coco."
        );
      });

      it(`refuses while custom agents are locked and leaves instructions.md as written (${LOCKED_ISSUE})`, async () => {
        seedAgent(vault, "coco", "Coco");
        const written = vault.readText("copilot/teammates/coco/instructions.md");
        await setCustomAgentsAccess("free");
        await store.start();

        await expect(store.updateAgent("coco", { name: "Bean" })).rejects.toThrow(
          "Copilot Teammates is locked."
        );

        expect(vault.readText("copilot/teammates/coco/instructions.md")).toBe(written);
      });
    });

    describe("saveFace()", () => {
      it("saves a preset's bytes byte for byte as face.webp, replacing the previous face", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();
        const before = store.getAgents()[0].faceSrc;

        await store.saveFace("coco", { kind: "preset", bytes: bytes(82, 73, 70, 70) });

        expect([...new Uint8Array(vault.readBytes("copilot/teammates/coco/face.webp")!)]).toEqual([
          82, 73, 70, 70,
        ]);
        expect(store.getAgents()[0].faceSrc).not.toBe(before);
      });

      it("saves an upload resized to a 256×256 WebP as face.webp", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();
        const canvas = installFakeFaceCanvas({
          uploadWidth: 2400,
          uploadHeight: 1600,
          encoded: new Uint8Array([87, 69, 66, 80]),
        });

        await store.saveFace("coco", { kind: "upload", image: new Blob(["large photo"]) });

        expect([canvas.width, canvas.height, canvas.encoded?.type]).toEqual([
          256,
          256,
          "image/webp",
        ]);
        expect([...new Uint8Array(vault.readBytes("copilot/teammates/coco/face.webp")!)]).toEqual([
          87, 69, 66, 80,
        ]);
      });

      it("keeps the old face when the license loses custom agents while an upload is still encoding (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();
        const release = holdUploadDecoding();
        const saved = store.saveFace("coco", { kind: "upload", image: new Blob(["photo"]) });

        store.stop();
        release();

        await expect(saved).rejects.toThrow("Copilot Teammates is not available.");
        expect([...new Uint8Array(vault.readBytes("copilot/teammates/coco/face.webp")!)]).toEqual([
          1, 2, 3,
        ]);
      });

      it(`refuses while custom agents are locked and keeps the old face (${LOCKED_ISSUE})`, async () => {
        seedAgent(vault, "coco", "Coco");
        await setCustomAgentsAccess("free");
        await store.start();

        await expect(
          store.saveFace("coco", { kind: "preset", bytes: bytes(82, 73, 70, 70) })
        ).rejects.toThrow("Copilot Teammates is locked.");

        expect([...new Uint8Array(vault.readBytes("copilot/teammates/coco/face.webp")!)]).toEqual([
          1, 2, 3,
        ]);
      });

      it("creates face.webp for an agent showing the placeholder", async () => {
        seedAgent(vault, "kai", "Kai", { withFace: false });
        await store.start();

        await store.saveFace("kai", { kind: "preset", bytes: bytes(5) });

        expect([...new Uint8Array(vault.readBytes("copilot/teammates/kai/face.webp")!)]).toEqual([
          5,
        ]);
        expect(store.getAgents()[0].faceSrc).not.toBe(NEUTRAL_FACE_SRC);
      });
    });

    describe("deleteAgent()", () => {
      it("sends the agent folder to Obsidian's trash and drops the agent from the list", async () => {
        seedAgent(vault, "coco", "Coco");
        seedAgent(vault, "maya", "Maya");
        await store.start();

        await store.deleteAgent("coco");

        expect(vault.trashedPaths).toEqual(["copilot/teammates/coco"]);
        expect(vault.listPaths()).toEqual([
          "copilot/teammates/maya/face.webp",
          "copilot/teammates/maya/instructions.md",
        ]);
        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["maya"]);
      });

      it(`still deletes while custom agents are locked, the one change a locked vault allows (${LOCKED_ISSUE})`, async () => {
        seedAgent(vault, "coco", "Coco");
        seedAgent(vault, "maya", "Maya");
        await setCustomAgentsAccess("free");
        await store.start();

        await store.deleteAgent("maya");

        expect(vault.trashedPaths).toEqual(["copilot/teammates/maya"]);
        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["coco"]);
      });

      it("rejects for an agent whose folder is gone, so the profile can report it", async () => {
        await store.start();

        await expect(store.deleteAgent("coco")).rejects.toThrow("No agent at coco.");
        expect(vault.trashedPaths).toEqual([]);
      });

      it.each(["", ".", "..", "maya/face.webp", "maya\\face.webp"])(
        "refuses the slug %p and trashes nothing, so a bad slug never reaches past one agent folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)",
        async (slug) => {
          seedAgent(vault, "maya", "Maya");
          await store.start();

          await expect(store.deleteAgent(slug)).rejects.toThrow(`No agent at ${slug}.`);
          expect(vault.trashedPaths).toEqual([]);
        }
      );
    });

    describe("loadForSession()", () => {
      it("returns the instruction without its frontmatter and MEMORY.md exactly as written", async () => {
        seedAgent(vault, "coco", "Coco", { instruction: "Keep the vault in view.\n" });
        const memory = "# Rules Coco remembers\n\n## How to work\n\n- Short paragraphs.\n";
        vault.writeByHand("copilot/teammates/coco/MEMORY.md", memory);
        await store.start();

        expect(await store.loadForSession("coco")).toEqual({
          instruction: "Keep the vault in view.\n",
          memory,
        });
      });

      it("reads a missing MEMORY.md as empty", async () => {
        seedAgent(vault, "coco", "Coco");
        await store.start();

        expect(await store.loadForSession("coco")).toEqual({
          instruction: "Coco handles things.",
          memory: "",
        });
      });

      it("returns null for an agent whose folder is gone", async () => {
        await store.start();

        expect(await store.loadForSession("coco")).toBeNull();
      });
    });
  });

  describe("customAgentsFolderPath()", () => {
    it("is the teammates folder inside the Copilot folder the user configured", () => {
      setSettings({ copilotFolder: "Tools/My Copilot" });

      expect(customAgentsFolderPath()).toBe("Tools/My Copilot/teammates");
    });
  });

  describe("runCustomAgentStoreWhileEnabled()", () => {
    it("starts the store when the gate turns full or locked, and lists nothing while a changed license token awaits verification", async () => {
      seedAgent(vault, "coco", "Coco");
      await setCustomAgentsAccess("unverified");
      const dispose = runCustomAgentStoreWhileEnabled(store);

      const listed = nextChange(store);
      await verifyStoredToken(true);
      await listed;
      expect(store.getAgents().map((agent) => agent.slug)).toEqual(["coco"]);

      setSettings({ entitlementToken: "changed-token" });
      expect(store.getAgents()).toEqual([]);

      const relisted = nextChange(store);
      await verifyStoredToken(false);
      await relisted;
      expect(store.getAgents().map((agent) => agent.slug)).toEqual(["coco"]);
      dispose();
    });

    it.each(["free", "keyless"] as const)(
      `lists the agents while the gate is locked for a %s device, so locked agents stay visible (${LOCKED_ISSUE})`,
      async (access) => {
        seedAgent(vault, "coco", "Coco");
        await setCustomAgentsAccess(access);

        const listed = nextChange(store);
        const dispose = runCustomAgentStoreWhileEnabled(store);
        await listed;

        expect(store.getAgents().map((agent) => agent.slug)).toEqual(["coco"]);
        dispose();
      }
    );

    it("reads nothing while the stored license token awaits verification at startup", async () => {
      seedAgent(vault, "coco", "Coco");
      const seeded = vault.touchedPaths.length;
      await setCustomAgentsAccess("unverified");

      const dispose = runCustomAgentStoreWhileEnabled(store);
      dispose();

      expect(vault.touchedPaths.slice(seeded)).toEqual([]);
      expect(store.getAgents()).toEqual([]);
    });

    it("stops the store when disposed with the plugin", async () => {
      seedAgent(vault, "coco", "Coco");
      await setCustomAgentsAccess("team");
      const listed = nextChange(store);
      const dispose = runCustomAgentStoreWhileEnabled(store);
      await listed;

      dispose();

      expect(store.getAgents()).toEqual([]);
    });
  });
});
