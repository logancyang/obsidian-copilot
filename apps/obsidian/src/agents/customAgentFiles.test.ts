import {
  deriveAgentSlug,
  encodeFace,
  FACE_SIZE_PX,
  findAgentNameConflict,
  findAgentNamed,
  parseInstructionsFile,
  serializeInstructionsFile,
  serializeModel,
} from "@/agents/customAgentFiles";
import { installFakeFaceCanvas } from "@/agents/testing/fakeFaceCanvas";

const KAI_FILE = [
  "---",
  "name: Kai",
  "title: Writes launch posts",
  "face: face.webp",
  `model: '{"baseModelId":"claude-sonnet-4-5","effort":"medium"}'`,
  "---",
  "You handle marketing for Obsidian Copilot.",
  "",
  "Plain words, short sentences.",
  "",
].join("\n");

describe("customAgentFiles", () => {
  describe("deriveAgentSlug()", () => {
    it.each([
      { name: "Coco", slug: "coco" },
      { name: "  Launch   Video Kai ", slug: "launch-video-kai" },
      { name: "Zoë", slug: "zoe" },
      { name: "R2-D2!", slug: "r2-d2" },
      { name: "可可", slug: "可可" },
      { name: "İpek", slug: "ipek" },
      { name: "../../Coco", slug: "coco" },
      { name: "a/b\\c", slug: "a-b-c" },
    ])("derives $slug from the name $name", ({ name, slug }) => {
      expect(deriveAgentSlug(name)).toBe(slug);
    });

    it("falls back to teammate for a name with no letters or digits, so the folder still has a name (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", () => {
      expect(deriveAgentSlug("!!!")).toBe("teammate");
    });

    it.each([
      { name: "Aux", slug: "aux-teammate" },
      { name: "CON", slug: "con-teammate" },
      { name: "Com1", slug: "com1-teammate" },
      { name: "lpt9", slug: "lpt9-teammate" },
    ])(
      "derives $slug from the name $name, because Windows cannot create a folder named after a device (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)",
      ({ name, slug }) => {
        expect(deriveAgentSlug(name)).toBe(slug);
      }
    );

    it("keeps a name that only starts with a Windows device name, such as Auxiliary or Con Artist", () => {
      expect(deriveAgentSlug("Auxiliary")).toBe("auxiliary");
      expect(deriveAgentSlug("Con Artist")).toBe("con-artist");
    });

    it("caps a long name at 48 characters without a trailing hyphen (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", () => {
      const slug = deriveAgentSlug(`${"a".repeat(47)} keeps going`);

      expect(slug).toBe("a".repeat(47));
    });

    it("counts the 48 characters by code point, so a long name never ends in half a character (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", () => {
      expect(deriveAgentSlug(`a${"𝓒".repeat(60)}`)).toBe(`a${"𝓒".repeat(47)}`);
    });
  });

  describe("findAgentNamed()", () => {
    it("finds the agent whose name matches, ignoring case and surrounding spaces", () => {
      const agents = [{ name: "Leo" }, { name: " Kai " }];

      expect(findAgentNamed(agents, "  kAI")).toBe(agents[1]);
    });

    it("finds nothing for a name no agent has", () => {
      expect(findAgentNamed([{ name: "Leo" }], "Leon")).toBeUndefined();
    });
  });

  describe("findAgentNameConflict()", () => {
    const COCO = { slug: "coco", name: "Coco" };

    it("finds no conflict for a name no agent has and no folder uses", () => {
      expect(findAgentNameConflict([COCO], ["coco"], "Maya")).toBeNull();
    });

    it.each(["COCO", " coco ", "Coco"])(
      "says Coco is already on the team for the name %p",
      (name) => {
        expect(findAgentNameConflict([COCO], ["coco"], name)).toBe(
          "Coco is already on your team. Pick another name."
        );
      }
    );

    it.each([
      { agent: { slug: "coco", name: "Chief" }, name: "Coco" },
      { agent: { slug: "maya-chen", name: "Maya Chen" }, name: "maya-chen" },
      { agent: { slug: "teammate", name: "!!!" }, name: "???" },
    ])(
      "says $agent.name already uses the folder $agent.slug for the name $name (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)",
      ({ agent, name }) => {
        expect(findAgentNameConflict([agent], [agent.slug], name)).toBe(
          `${agent.name} already uses the folder ${agent.slug}. Pick another name.`
        );
      }
    );

    it("says a folder of that name exists when it holds no agent, matching the folder in any case (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", () => {
      expect(findAgentNameConflict([COCO], ["coco", "Kai"], "Kai")).toBe(
        "A folder named kai already exists in your teammates folder. Pick another name."
      );
    });
  });

  describe("serializeInstructionsFile()", () => {
    it("writes name, title, face and model as properties and the instruction as the body", () => {
      const content = serializeInstructionsFile(
        {
          name: "Kai",
          title: "Writes launch posts",
          model: { baseModelId: "claude-sonnet-4-5", effort: "medium" },
        },
        "You handle marketing for Obsidian Copilot.\n\nPlain words, short sentences.\n"
      );

      expect(content).toBe(KAI_FILE);
    });

    it("writes an empty title and model when none is chosen, so the Properties view still lists them", () => {
      const content = serializeInstructionsFile({ name: "Leo", title: "", model: null }, "Books.");

      expect(parseInstructionsFile(content)).toEqual({
        name: "Leo",
        title: "",
        model: null,
        instruction: "Books.",
      });
    });
  });

  describe("serializeModel()", () => {
    it("writes a model choice as the same JSON a chat note records", () => {
      expect(serializeModel({ baseModelId: "gpt-5.5", effort: null })).toBe(
        '{"baseModelId":"gpt-5.5","effort":null}'
      );
    });

    it("writes no model as an empty value", () => {
      expect(serializeModel(null)).toBe("");
    });
  });

  describe("parseInstructionsFile()", () => {
    it("reads the properties and returns the body with the frontmatter stripped", () => {
      expect(parseInstructionsFile(KAI_FILE)).toEqual({
        name: "Kai",
        title: "Writes launch posts",
        model: { baseModelId: "claude-sonnet-4-5", effort: "medium" },
        instruction:
          "You handle marketing for Obsidian Copilot.\n\nPlain words, short sentences.\n",
      });
    });

    it("keeps a --- line inside the body as part of the instruction", () => {
      const content = "---\nname: Kai\n---\nBefore\n---\nAfter\n";

      expect(parseInstructionsFile(content).instruction).toBe("Before\n---\nAfter\n");
    });

    it("returns the whole file as the instruction when it has no frontmatter", () => {
      expect(parseInstructionsFile("Just an instruction.")).toEqual({
        name: "",
        title: "",
        model: null,
        instruction: "Just an instruction.",
      });
    });

    it.each([
      { case: "a model that is not JSON", model: "'Opus'" },
      { case: "a model without a base model id", model: `'{"effort":"high"}'` },
    ])(
      "reads $case as no model, so a hand edit falls back to the default model (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)",
      ({ model }) => {
        const content = `---\nname: Kai\nmodel: ${model}\n---\nBody`;

        expect(parseInstructionsFile(content).model).toBeNull();
      }
    );

    it("reads frontmatter that is not valid YAML as no properties and keeps the body, so a hand edit never hides the agent (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)", () => {
      const content = "---\nname: [Kai\n---\nBody";

      expect(parseInstructionsFile(content)).toEqual({
        name: "",
        title: "",
        model: null,
        instruction: "Body",
      });
    });
  });

  describe("encodeFace()", () => {
    it("returns a preset's bytes unchanged, so the CDN file is saved byte for byte", async () => {
      const preset = new Uint8Array([82, 73, 70, 70, 9]).buffer;

      expect(await encodeFace({ kind: "preset", bytes: preset })).toBe(preset);
    });

    it("crops the centered square of a landscape upload and scales it to a 256×256 WebP", async () => {
      const canvas = installFakeFaceCanvas({ uploadWidth: 900, uploadHeight: 600 });

      const bytes = await encodeFace({ kind: "upload", image: new Blob(["photo"]) });

      expect([...new Uint8Array(bytes)]).toEqual([82, 73, 70, 70]);
      expect(FACE_SIZE_PX).toBe(256);
      expect([canvas.width, canvas.height]).toEqual([256, 256]);
      expect(canvas.context?.drawImage).toHaveBeenCalledWith(
        canvas.bitmap,
        150,
        0,
        600,
        600,
        0,
        0,
        256,
        256
      );
      expect(canvas.encoded?.type).toBe("image/webp");
      expect(canvas.bitmap.close).toHaveBeenCalled();
    });

    it("crops the centered square of a portrait upload", async () => {
      const canvas = installFakeFaceCanvas({ uploadWidth: 400, uploadHeight: 1000 });

      await encodeFace({ kind: "upload", image: new Blob(["photo"]) });

      expect(canvas.context?.drawImage).toHaveBeenCalledWith(
        canvas.bitmap,
        0,
        300,
        400,
        400,
        0,
        0,
        256,
        256
      );
    });

    it.each([
      { failure: "has no 2D context", options: { hasContext: false } },
      { failure: "cannot encode WebP", options: { encoded: null } },
    ])(
      "rejects and releases the decoded upload when the canvas $failure, so the picker can report the upload failed (https://github.com/Brevilabs/obsidian-copilot-private/issues/936)",
      async ({ options }) => {
        const canvas = installFakeFaceCanvas({ uploadWidth: 100, uploadHeight: 100, ...options });

        await expect(encodeFace({ kind: "upload", image: new Blob(["photo"]) })).rejects.toThrow(
          "Could not encode the image."
        );
        expect(canvas.bitmap.close).toHaveBeenCalled();
      }
    );
  });
});
