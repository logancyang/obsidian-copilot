/** @jest-environment node */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Linter } = require("eslint");
const tsParser = require("@typescript-eslint/parser");
const {
  clientBoxes,
  compareDebt,
  createBoxOf,
  globToRegExp,
  importRows,
  loadArchitecture,
  noHostAccessInClient,
  readDebtAt,
} = require("./architecture");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/993";
const SLOW_TEST_MS = 120000;

const root = process.cwd();
const { graph, debt } = loadArchitecture(root);
const boxOf = createBoxOf(graph);

const linter = new Linter({ configType: "flat" });
const CLIENT_ACCESS_RULE = "copilot/no-host-access-in-client";
const clientAccessConfig = [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { copilot: { rules: { "no-host-access-in-client": noHostAccessInClient } } },
    rules: { [CLIENT_ACCESS_RULE]: "error" },
  },
];

function hostAccessIn(file, text) {
  return linter
    .verify(text, clientAccessConfig, { filename: path.join(root, file) })
    .filter((message) => message.fatal || message.ruleId === CLIENT_ACCESS_RULE)
    .map((message) => (message.fatal ? `could not parse: ${message.message}` : message.message));
}

function hostAccessInCode(code) {
  return hostAccessIn("src/example.ts", code).map((message) => message.split(" reaches ")[0]);
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

function lintWithRepoConfig(probes) {
  const script = `
    const { ESLint } = require("eslint");
    const eslint = new ESLint();
    (async () => {
      const reports = [];
      for (const [filePath, source] of JSON.parse(process.argv[1])) {
        const [result] = await eslint.lintText(source, { filePath });
        reports.push(result.messages.map((message) => message.ruleId + ": " + message.message));
      }
      process.stdout.write(JSON.stringify(reports));
    })();
  `;
  const output = execFileSync(process.execPath, ["-e", script, JSON.stringify(probes)], {
    cwd: root,
  });
  return JSON.parse(output.toString());
}

function debtWith(imports, clientAccess) {
  return { counts: { imports, clientAccess }, imports: {}, clientAccess: [] };
}

function commitDebt(repo, debtFile) {
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  if (debtFile) {
    fs.writeFileSync(path.join(repo, "architecture.debt.json"), JSON.stringify(debtFile));
  }
  git("add", "--all");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--no-verify",
    "--allow-empty",
    "-qm",
    "commit"
  );
  return git("rev-parse", "HEAD").toString().trim();
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
          { box: "protocol", files: ["src/chat/types.ts"] },
          { box: "host/chat", files: ["src/chat/**"] },
        ],
      });

      expect(boxed("src/chat/types.ts")).toBe("protocol");
      expect(boxed("src/chat/AgentSession.ts")).toBe("host/chat");
    });

    it("puts a file no box claims in no box", () => {
      expect(createBoxOf({ boxes: [{ box: "core", files: ["src/**"] }] })("dev/x.ts")).toBe(null);
    });

    it(`puts a feature's components and hooks in its client box and its other files in its host box (${ISSUE})`, () => {
      expect(boxOf("apps/obsidian/src/agents/ui/AgentRoster.tsx")).toBe(
        "client/features/teammates"
      );
      expect(boxOf("apps/obsidian/src/agents/agentMode/ui/AgentProfile.tsx")).toBe(
        "client/features/teammates"
      );
      expect(
        boxOf("apps/obsidian/src/projects/hooks/useRefreshEmptyLandingOnContextSourceChange.ts")
      ).toBe("client/features/projects");
      expect(boxOf("apps/obsidian/src/agents/customAgentsGate.ts")).toBe("host/features/teammates");
      expect(boxOf("apps/obsidian/src/agents/agentMode/hiddenAgentChats.ts")).toBe(
        "host/features/teammates"
      );
    });
  });

  describe("clientBoxes()", () => {
    it("names the boxes whose code must run in any shell, outside Obsidian too", () => {
      expect([...clientBoxes(graph)].sort()).toEqual([
        "client/chat",
        "client/chatKit",
        "client/features/connectors",
        "client/features/customCommands",
        "client/features/excalidraw",
        "client/features/miyo",
        "client/features/navigator",
        "client/features/projects",
        "client/features/skills",
        "client/features/teammates",
        "core",
        "protocol",
      ]);
    });
  });

  describe("importRows()", () => {
    const rowOf = (box) => importRows(graph).find((row) => row.box === box);

    it("lets the chat UI import only the client boxes below it", () => {
      expect(rowOf("client/chat").allowed).toEqual(["core", "protocol", "client/chatKit"]);
    });

    it("lets a feature import the chat client and the boxes below it, never another feature", () => {
      expect(rowOf("client/features/miyo").allowed).toEqual([
        "core",
        "protocol",
        "client/chatKit",
        "client/chat",
      ]);
    });

    it("lets a feature's host part import the chat host and its own client part, never another feature", () => {
      expect(rowOf("host/features/teammates").allowed).toEqual([
        "core",
        "host/platform",
        "protocol",
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

  describe("compareDebt()", () => {
    it("passes when both debt totals stay the same or shrink", () => {
      expect(compareDebt(debtWith(739, 151), debtWith(739, 151)).ok).toBe(true);
      expect(compareDebt(debtWith(739, 151), debtWith(700, 150)).ok).toBe(true);
    });

    it(`fails when either total grows, naming both totals and telling the author to fix the import (${ISSUE})`, () => {
      const result = compareDebt(debtWith(739, 151), debtWith(740, 150));

      expect(result.ok).toBe(false);
      expect(result.message).toContain("imports 739 -> 740");
      expect(result.message).toContain("client access 151 -> 150");
      expect(result.message).toContain("fix the import instead of listing it");
      expect(compareDebt(debtWith(739, 151), debtWith(739, 152)).ok).toBe(false);
    });
  });

  describe("readDebtAt()", () => {
    let repo;

    beforeEach(() => {
      repo = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-debt-"));
      execFileSync("git", ["init", "-q"], { cwd: repo });
    });

    afterEach(() => {
      fs.rmSync(repo, { recursive: true, force: true });
    });

    it("returns the debt file as it was committed at the given ref", () => {
      const base = commitDebt(repo, debtWith(3, 2));
      commitDebt(repo, debtWith(4, 2));

      expect(readDebtAt(base, repo).counts).toEqual({ imports: 3, clientAccess: 2 });
    });

    it(`throws when the ref or its debt file is missing, so an unreadable base branch cannot pass the check (${ISSUE})`, () => {
      const withoutDebt = commitDebt(repo);
      commitDebt(repo, debtWith(3, 2));

      expect(() => readDebtAt("origin/no-such-branch", repo)).toThrow("origin/no-such-branch");
      expect(() => readDebtAt(withoutDebt, repo)).toThrow(withoutDebt);
    });
  });

  describe("noHostAccessInClient", () => {
    it("reports each way client code can reach Node or Electron", () => {
      const code = [
        'import { requireNodeModule } from "@/utils/desktopRuntime";',
        'import { readFile } from "node:fs";',
        'const cp = window.require("child_process");',
        'const shell = require("electron").shell;',
        'import { ipcRenderer } from "electron";',
        "const os = process.platform;",
        'const bytes = Buffer.from("a");',
        "const here = __dirname + __filename;",
      ].join("\n");

      expect(hostAccessInCode(code).sort()).toEqual([
        ".require",
        "Buffer",
        "__dirname",
        "__filename",
        'import "electron"',
        'import "node:fs"',
        "process",
        "require",
        "requireNodeModule",
      ]);
    });

    it(`reports Obsidian imports, including type-only imports and type queries (${ISSUE})`, () => {
      const code = [
        'import { Notice } from "obsidian";',
        'import type { TFile } from "obsidian";',
        'export type { App } from "obsidian";',
        'type Vault = import("obsidian").Vault;',
        'const lazy = () => import("obsidian");',
      ].join("\n");

      expect(hostAccessInCode(code).sort()).toEqual([
        'import "obsidian"',
        'import "obsidian"',
        'import "obsidian"',
        'import("obsidian")',
        'import("obsidian")',
      ]);
    });

    it(`reports Node types, which a client package without Node types cannot compile (${ISSUE})`, () => {
      const code = [
        'import type { IpcRenderer } from "electron";',
        'type Fs = typeof import("node:fs");',
        "let bytes: Buffer | undefined;",
        "let timer: NodeJS.Timeout | undefined;",
      ].join("\n");

      expect(hostAccessInCode(code).sort()).toEqual([
        "Buffer",
        "NodeJS",
        'import "electron"',
        'import("node:fs")',
      ]);
    });

    it("reports Node reached through a cast, an alias, a namespace or a global object", () => {
      const code = [
        'import { requireNodeModule as load } from "@/utils/desktopRuntime";',
        'import * as runtime from "@/utils/desktopRuntime";',
        'export { shell } from "electron";',
        "const container = window as unknown as { require?: (id: string) => unknown };",
        'const cp = container.require?.("child_process");',
        'const fs = runtime.requireNodeModule("fs");',
        "const os = globalThis.process?.platform;",
      ].join("\n");

      expect(hostAccessInCode(code).sort()).toEqual([
        ".require",
        ".requireNodeModule",
        "globalThis.process",
        'import "electron"',
        "requireNodeModule",
      ]);
    });

    it(`reports Node globals and require destructured from an object (${ISSUE})`, () => {
      const code = [
        "const { process: nodeProcess } = globalThis;",
        'const { "Buffer": NodeBuffer } = window as any;',
        "const { require: load } = activeWindow.app;",
        "const { document } = window;",
      ].join("\n");

      expect(hostAccessInCode(code).sort()).toEqual([
        ".require",
        "globalThis.process",
        "window.Buffer",
      ]);
    });

    it("allows process.env.NODE_ENV, which the bundler replaces at build time", () => {
      expect(hostAccessInCode('const production = process.env.NODE_ENV === "production";')).toEqual(
        []
      );
    });

    it(`reports process.env read with a computed key, which the bundler leaves as runtime access (${ISSUE})`, () => {
      const code = [
        'const NODE_ENV = "HOME";',
        "export const home = process.env[NODE_ENV];",
        'export const mode = process["env"].NODE_ENV;',
      ].join("\n");

      expect(hostAccessInCode(code)).toEqual(["process", "process"]);
    });

    it("allows a local variable that only shares a Node global's name", () => {
      expect(
        hostAccessInCode("function run(process: { id: number }) { return process.id; }")
      ).toEqual([]);
    });
  });

  describe("eslint.config.mjs", () => {
    const CLIENT_FILE = "apps/obsidian/src/agentMode/ui/DirectiveProbe.js";
    const PROBES = [
      ["boundaries/dependencies", CLIENT_FILE, 'import { getSettings } from "@/settings/model";'],
      ["copilot/no-host-access-in-client", CLIENT_FILE, 'import { Notice } from "obsidian";'],
      [
        "boundaries/no-unknown-files",
        "apps/obsidian/src/notInAnyBox/DirectiveProbe.js",
        "export const a = 1;",
      ],
    ];
    const disableForms = (rule, line) => [
      `// eslint-disable-next-line ${rule} -- probe\n${line}`,
      `${line} // eslint-disable-line ${rule} -- probe`,
      `/* eslint-disable ${rule} -- probe */\n${line}\n/* eslint-enable ${rule} -- probe */`,
      `/* eslint-disable -- probe */\n${line}\n/* eslint-enable -- probe */`,
    ];
    const restrictedDisables = (report) =>
      report.filter((line) => line.startsWith("eslint-comments/no-restricted-disable: "));

    it(
      "still lets a described disable comment silence a rule outside the boundary",
      () => {
        const [report] = lintWithRepoConfig([
          [
            CLIENT_FILE,
            "// eslint-disable-next-line no-control-regex -- matches a NUL byte\nexport const nul = /\\x00/;",
          ],
        ]);

        expect(report).toEqual([]);
      },
      SLOW_TEST_MS
    );

    it(
      `rejects a next-line, line, block or bare disable comment for each boundary rule, so an import cannot skip architecture.debt.json (${ISSUE})`,
      () => {
        const probes = PROBES.flatMap(([rule, file, line]) =>
          disableForms(rule, line).map((source) => [file, source])
        );
        const reports = lintWithRepoConfig(probes).map(restrictedDisables);

        expect(reports).toEqual(
          PROBES.flatMap(([rule]) => [
            ...Array(3).fill([
              `eslint-comments/no-restricted-disable: Disabling '${rule}' is not allowed.`,
            ]),
            [
              expect.stringContaining(
                "boundaries/*,copilot/no-host-access-in-client' is not allowed."
              ),
            ],
          ])
        );
      },
      SLOW_TEST_MS
    );

    it(
      `rejects an inline config comment, which could turn a boundary rule off without a disable comment (${ISSUE})`,
      () => {
        const [report] = lintWithRepoConfig([
          [
            CLIENT_FILE,
            '/* eslint boundaries/dependencies: "off" -- probe */\nexport const a = 1;',
          ],
        ]);

        expect(report).toEqual(["eslint-comments/no-use: Unexpected ESLint directive comment."]);
      },
      SLOW_TEST_MS
    );
  });

  describe("architecture.json", () => {
    it("names only patterns that still match a source file, so a moved or deleted file leaves no dead entry", () => {
      const sources = [
        ...trackedSourceFiles("apps/obsidian/src"),
        ...trackedSourceFiles("packages"),
      ];
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
        clientAccess: debt.clientAccess.length,
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
      `names only client files that still reach Node, Electron or Obsidian (${ISSUE})`,
      () => {
        const stale = debt.clientAccess.filter((file) => {
          const text = fs.existsSync(path.join(root, file)) ? readSource(file) : "";
          return hostAccessIn(file, text).length === 0;
        });

        expect(stale).toEqual([]);
      },
      SLOW_TEST_MS
    );

    it("names no host file in its client access list, since host code may use Node and Obsidian", () => {
      const client = clientBoxes(graph);

      expect(debt.clientAccess.filter((file) => !client.has(boxOf(file)))).toEqual([]);
    });
  });
});
