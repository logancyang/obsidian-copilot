/** @jest-environment node */
const fs = require("fs");
const path = require("path");
const {
  clientBoxes,
  createBoxOf,
  globToRegExp,
  importRows,
  loadArchitecture,
} = require("./architecture");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/993";

const root = process.cwd();
const { graph, debt } = loadArchitecture(root);
const boxOf = createBoxOf(graph);

function readSource(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function trackedSourceFiles(folder) {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return trackedSourceFiles(relative);
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

describe("architecture", () => {
  describe("globToRegExp()", () => {
    it("matches one path segment for * and any depth for **", () => {
      expect(globToRegExp("src/*/ui/**").test("src/chat/ui/cards/Card.tsx")).toBe(true);
      expect(globToRegExp("src/*/ui/**").test("src/chat/deep/ui/Card.tsx")).toBe(false);
    });

    it("matches each alternative in braces and nothing else", () => {
      const pattern = globToRegExp("src/{logger,constants}.ts");

      expect(pattern.test("src/logger.ts")).toBe(true);
      expect(pattern.test("src/constants.ts")).toBe(true);
      expect(pattern.test("src/loggerXts")).toBe(false);
    });
  });

  describe("createBoxOf()", () => {
    it("puts a file in the first box whose pattern matches it", () => {
      const boxed = createBoxOf({
        boxes: [
          { box: "client/protocol", files: ["src/chat/types.ts"] },
          { box: "host/chat", files: ["src/chat/**"] },
        ],
      });

      expect(boxed("src/chat/types.ts")).toBe("client/protocol");
      expect(boxed("src/chat/AgentSession.ts")).toBe("host/chat");
    });

    it("puts a file no box claims in no box", () => {
      expect(createBoxOf({ boxes: [{ box: "client/core", files: ["src/**"] }] })("dev/x.ts")).toBe(
        null
      );
    });

    it(`puts a feature's components and hooks in its client box and its other files in its host box (${ISSUE})`, () => {
      expect(boxOf("src/agents/ui/AgentRoster.tsx")).toBe("client/features/teammates");
      expect(boxOf("src/agents/agentMode/ui/AgentProfile.tsx")).toBe("client/features/teammates");
      expect(boxOf("src/projects/hooks/useRefreshEmptyLandingOnContextSourceChange.ts")).toBe(
        "client/features/projects"
      );
      expect(boxOf("src/agents/customAgentsGate.ts")).toBe("host/features/teammates");
      expect(boxOf("src/agents/agentMode/hiddenAgentChats.ts")).toBe("host/features/teammates");
    });
  });

  describe("clientBoxes()", () => {
    it("names the boxes whose code must run in any shell, outside Obsidian too", () => {
      expect([...clientBoxes(graph)].sort()).toEqual([
        "client/chat",
        "client/chatKit",
        "client/core",
        "client/features/connectors",
        "client/features/customCommands",
        "client/features/excalidraw",
        "client/features/miyo",
        "client/features/navigator",
        "client/features/projects",
        "client/features/skills",
        "client/features/teammates",
        "client/protocol",
      ]);
    });
  });

  describe("importRows()", () => {
    const rowOf = (box) => importRows(graph).find((row) => row.box === box);

    it("lets the chat UI import only the client boxes below it", () => {
      expect(rowOf("client/chat").allowed).toEqual([
        "client/core",
        "client/protocol",
        "client/chatKit",
      ]);
    });

    it("lets a feature import the chat client and the boxes below it, never another feature", () => {
      expect(rowOf("client/features/miyo").allowed).toEqual([
        "client/core",
        "client/protocol",
        "client/chatKit",
        "client/chat",
      ]);
    });

    it("lets a feature's host part import the chat host and its own client part, never another feature", () => {
      expect(rowOf("host/features/teammates").allowed).toEqual([
        "client/core",
        "host/platform",
        "client/protocol",
        "host/chat",
        "client/features/teammates",
      ]);
    });

    it(`lets no client box import a host box, so the client compiles without the plugin (${ISSUE})`, () => {
      const client = clientBoxes(graph);
      const reachingHost = importRows(graph)
        .filter(({ box }) => client.has(box))
        .flatMap(({ box, allowed }) =>
          allowed.filter((to) => !client.has(to)).map((to) => `${box} -> ${to}`)
        );

      expect(reachingHost).toEqual([]);
    });

    it("gives every row and every allowed import a box that exists", () => {
      const boxes = new Set(graph.boxes.map(({ box }) => box));
      const unknown = importRows(graph)
        .flatMap(({ box, allowed }) => [box, ...allowed])
        .filter((box) => !boxes.has(box));

      expect(unknown).toEqual([]);
    });
  });

  describe("architecture.json", () => {
    it("names only patterns that still match a source file, so a moved or deleted file leaves no dead entry", () => {
      const sources = trackedSourceFiles("src");
      const dead = graph.boxes.flatMap(({ box, files }) =>
        files
          .filter((glob) => !sources.some((file) => globToRegExp(glob).test(file)))
          .map((glob) => `${box}: ${glob}`)
      );

      expect(dead).toEqual([]);
    });
  });

  describe("architecture.debt.json", () => {
    it("states the totals of its own lists, so a review sees the numbers move", () => {
      expect(debt.counts).toEqual({
        imports: Object.values(debt.imports).reduce((sum, list) => sum + list.length, 0),
      });
    });

    it(`names only imports that still exist, so an entry is deleted together with the import it excused (${ISSUE})`, () => {
      const stale = Object.entries(debt.imports).flatMap(([file, specifiers]) => {
        const text = fs.existsSync(path.join(root, file)) ? readSource(file) : "";
        return specifiers
          .filter((specifier) => !text.includes(`"${specifier}"`))
          .map((specifier) => `${file} -> ${specifier}`);
      });

      expect(stale).toEqual([]);
    });
  });
});
