/** @jest-environment node */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Linter } = require("eslint");
const tsParser = require("@typescript-eslint/parser");
const {
  createBoxOf,
  desktopBoxes,
  globToRegExp,
  importRows,
  loadArchitecture,
  mobileLoadClosure,
  noNodeInPortableCode,
  resolveImport,
  staticValueImports,
} = require("./architecture");

const ISSUE = "ARCH_ISSUE_URL";
const SLOW_TEST_MS = 120000;
const NODE_ACCESS_HINT = /requireNodeModule|require\(|electron|process|Buffer|__dirname|__filename/;

const root = process.cwd();
const { graph, debt } = loadArchitecture(root);
const boxOf = createBoxOf(graph);

const linter = new Linter({ configType: "flat" });
const NODE_ACCESS_RULE = "copilot/no-node-in-portable-code";
const nodeAccessConfig = [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { copilot: { rules: { "no-node-in-portable-code": noNodeInPortableCode } } },
    rules: { [NODE_ACCESS_RULE]: "error" },
  },
];

function nodeAccessIn(file, text) {
  return linter
    .verify(text, nodeAccessConfig, { filename: path.join(root, file) })
    .filter((message) => message.fatal || message.ruleId === NODE_ACCESS_RULE)
    .map((message) => (message.fatal ? `could not parse: ${message.message}` : message.message));
}

function nodeAccessInCode(code) {
  return nodeAccessIn("src/example.ts", code).map((message) => message.split(" reaches ")[0]);
}

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

function writeProject(files) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    fs.writeFileSync(path.join(project, file), text);
  }
  return project;
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
          { box: "chat/protocol", files: ["src/chat/types.ts"] },
          { box: "chat/desktop", files: ["src/chat/**"] },
        ],
      });

      expect(boxed("src/chat/types.ts")).toBe("chat/protocol");
      expect(boxed("src/chat/AgentSession.ts")).toBe("chat/desktop");
    });

    it("puts a file no box claims in no box", () => {
      expect(createBoxOf({ boxes: [{ box: "kernel", files: ["src/**"] }] })("dev/x.ts")).toBe(null);
    });

    it(`puts a file listed for a desktop folder in that desktop box before it has moved (${ISSUE})`, () => {
      expect(boxOf("src/agents/agentMode/hiddenAgentChats.ts")).toBe("features/teammates/desktop");
      expect(boxOf("src/agents/agentTitle.ts")).toBe("features/teammates");
    });
  });

  describe("desktopBoxes()", () => {
    it("names the boxes whose code may run only where Node exists", () => {
      expect([...desktopBoxes(graph)].sort()).toEqual([
        "app/desktop",
        "backends",
        "chat/desktop",
        "features/connectors/desktop",
        "features/skills/desktop",
        "features/teammates/desktop",
        "platform/desktop",
      ]);
    });
  });

  describe("importRows()", () => {
    const rowOf = (box) => importRows(graph).find((row) => row.box === box);

    it("lets a feature import the chat client and the boxes below it, never another feature", () => {
      expect(rowOf("features/miyo").value).toEqual([
        "kernel",
        "platform",
        "chat/protocol",
        "chat/kit",
        "chat/ui",
      ]);
    });

    it("lets a feature's desktop folder import the chat host and its own portable code", () => {
      expect(rowOf("features/teammates/desktop").value).toEqual([
        "kernel",
        "platform",
        "platform/desktop",
        "chat/protocol",
        "chat/kit",
        "chat/ui",
        "chat/desktop",
        "features/teammates",
      ]);
    });

    it(`lets portable code name its own desktop folder, and one below it, only as a type (${ISSUE})`, () => {
      expect(rowOf("features/teammates").typeOnly).toEqual([
        "features/teammates/desktop",
        "platform/desktop",
      ]);
      expect(rowOf("chat/ui").typeOnly).toEqual(["platform/desktop"]);
    });

    it("gives a desktop box no type-only allowance, since it may import what its row lists outright", () => {
      expect(rowOf("chat/desktop").typeOnly).toEqual([]);
    });
  });

  describe("staticValueImports()", () => {
    it("lists value imports, side-effect imports and re-exports", () => {
      const code = [
        'import a, { b } from "@/a";',
        'import "@/side-effect";',
        'export { c } from "./c";',
        'export * from "./d";',
      ].join("\n");

      expect(staticValueImports("x.ts", code)).toEqual(["@/a", "@/side-effect", "./c", "./d"]);
    });

    it(`leaves out imports that load no code on a phone: type-only imports and import() (${ISSUE})`, () => {
      const code = [
        'import type { A } from "@/a";',
        'import { type B, type C } from "@/b";',
        'export type { D } from "@/d";',
        'const lazy = () => import("@/desktop");',
        'import { type E, f } from "@/mixed";',
      ].join("\n");

      expect(staticValueImports("x.ts", code)).toEqual(["@/mixed"]);
    });
  });

  describe("resolveImport()", () => {
    it("resolves an alias, a relative path and a folder index to repo-relative files", () => {
      const project = writeProject({
        "src/a.ts": "",
        "src/ui/B.tsx": "",
        "src/pkg/index.ts": "",
      });

      expect(resolveImport(project, "src/main.ts", "@/a")).toBe("src/a.ts");
      expect(resolveImport(project, "src/main.ts", "./ui/B")).toBe("src/ui/B.tsx");
      expect(resolveImport(project, "src/main.ts", "@/pkg")).toBe("src/pkg/index.ts");
    });

    it("resolves nothing for a package import or a missing file", () => {
      const project = writeProject({ "src/a.ts": "" });

      expect(resolveImport(project, "src/main.ts", "obsidian")).toBe(null);
      expect(resolveImport(project, "src/main.ts", "@/missing")).toBe(null);
    });
  });

  describe("mobileLoadClosure()", () => {
    it("follows static value imports from the entry and stops at import() and type-only imports", () => {
      const project = writeProject({
        "src/main.ts":
          'import "@/portable";\nimport type { T } from "@/typed";\nvoid import("@/desktop");',
        "src/portable.ts": 'export * from "./deeper";',
        "src/deeper.ts": "export const x = 1;",
        "src/typed.ts": "export type T = 1;",
        "src/desktop.ts": 'import "@/onlyDesktop";',
        "src/onlyDesktop.ts": "",
      });

      expect(mobileLoadClosure(project)).toEqual([
        "src/deeper.ts",
        "src/main.ts",
        "src/portable.ts",
      ]);
    });

    describe("for the plugin a phone loads", () => {
      const closure = mobileLoadClosure(root);

      it(
        `holds no file from a desktop-only box, so a phone never evaluates desktop code at load (${ISSUE})`,
        () => {
          const desktop = desktopBoxes(graph);

          expect(closure.length).toBeGreaterThan(100);
          expect(closure.filter((file) => desktop.has(boxOf(file)))).toEqual([]);
        },
        SLOW_TEST_MS
      );

      it(
        `holds no file that reaches Node or Electron beyond the ones architecture.debt.json names (${ISSUE})`,
        () => {
          const known = new Set(debt.nodeAccess);
          const reaching = closure.filter((file) => {
            if (known.has(file)) return false;
            const text = readSource(file);
            return NODE_ACCESS_HINT.test(text) && nodeAccessIn(file, text).length > 0;
          });

          expect(reaching).toEqual([]);
        },
        SLOW_TEST_MS
      );
    });
  });

  describe("noNodeInPortableCode", () => {
    it("reports each way portable code can reach Node or Electron", () => {
      const code = [
        'const fs = requireNodeModule("fs");',
        'const cp = window.require("child_process");',
        'const shell = require("electron").shell;',
        'import { ipcRenderer } from "electron";',
        "const os = process.platform;",
        'const bytes = Buffer.from("a");',
        "const here = __dirname + __filename;",
      ].join("\n");

      expect(nodeAccessInCode(code).sort()).toEqual([
        "Buffer",
        "__dirname",
        "__filename",
        'import "electron"',
        "process",
        'require("electron")',
        "requireNodeModule()",
        "window.require()",
      ]);
    });

    it(`allows what loads no Node code: process.env.NODE_ENV, type queries and type-only imports (${ISSUE})`, () => {
      const code = [
        'const production = process.env.NODE_ENV === "production";',
        'type Fs = typeof import("node:fs");',
        'import type { IpcRenderer } from "electron";',
        "let bytes: Buffer | undefined;",
      ].join("\n");

      expect(nodeAccessInCode(code)).toEqual([]);
    });

    it("allows a local variable that only shares a Node global's name", () => {
      expect(
        nodeAccessInCode("function run(process: { id: number }) { return process.id; }")
      ).toEqual([]);
    });
  });

  describe("architecture.json", () => {
    const sources = trackedSourceFiles("src");

    it("names only patterns that still match a source file, so a moved or deleted file leaves no dead entry", () => {
      const dead = graph.boxes.flatMap(({ box, files }) =>
        files
          .filter((glob) => !sources.some((file) => globToRegExp(glob).test(file)))
          .map((glob) => `${box}: ${glob}`)
      );

      expect(dead).toEqual([]);
    });

    it("gives every import row a box that exists", () => {
      const boxes = new Set(graph.boxes.map(({ box }) => box));
      const unknown = importRows(graph)
        .flatMap(({ box, value, typeOnly }) => [box, ...value, ...typeOnly])
        .filter((box) => !boxes.has(box));

      expect(unknown).toEqual([]);
    });
  });

  describe("architecture.debt.json", () => {
    it("states the totals of its own lists, so a review sees the numbers move", () => {
      expect(debt.counts).toEqual({
        imports: Object.values(debt.imports).reduce((sum, list) => sum + list.length, 0),
        nodeAccess: debt.nodeAccess.length,
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

    it(
      `names only portable files that still reach Node or Electron (${ISSUE})`,
      () => {
        const stale = debt.nodeAccess.filter((file) => {
          const text = fs.existsSync(path.join(root, file)) ? readSource(file) : "";
          return nodeAccessIn(file, text).length === 0;
        });

        expect(stale).toEqual([]);
      },
      SLOW_TEST_MS
    );

    it("names no file from a desktop-only box, where Node access is allowed", () => {
      const desktop = desktopBoxes(graph);

      expect(debt.nodeAccess.filter((file) => desktop.has(boxOf(file)))).toEqual([]);
    });
  });
});
