import obsidianmd from "eslint-plugin-obsidianmd";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import tailwind from "eslint-plugin-tailwindcss";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import { isBuiltin } from "node:module";

const NODE_IMPORT_GUIDANCE =
  "Use requireNodeModule() from '@/utils/desktopRuntime' for runtime access; use an import(\"node:...\") type query when only a type is needed.";

const noDirectNodeImportsRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      directNodeImport: `Do not access Node.js built-in module "{{moduleName}}" directly. ${NODE_IMPORT_GUIDANCE}`,
    },
  },
  create(context) {
    const reportIfBuiltin = (node, moduleName) => {
      if (typeof moduleName === "string" && isBuiltin(moduleName)) {
        context.report({
          node,
          messageId: "directNodeImport",
          data: { moduleName },
        });
      }
    };

    return {
      ImportDeclaration(node) {
        reportIfBuiltin(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          reportIfBuiltin(node, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        reportIfBuiltin(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") {
          reportIfBuiltin(node, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        ) {
          reportIfBuiltin(node, node.arguments[0].value);
        }
      },
    };
  },
};

const GITHUB_ISSUE_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+(?![\w-])/;
const TOOL_DIRECTIVE =
  /^(eslint-disable|eslint-enable|@ts-|prettier-ignore|(istanbul|c8|v8) ignore|webpack[A-Z]|@vite-ignore|#(end)?region\b|[@#]__PURE__|[@#]__NO_SIDE_EFFECTS__|@jsx|@license|@preserve|@(jest|vitest)-environment|@type\s|@satisfies|@typedef|<reference|<amd-)/;
const BLOCK_ONLY_DIRECTIVE = /^(eslint-env|eslint|globals?|exported)\s/;

const isToolDirective = (comment) => {
  const body = comment.value.replace(/^[/*\s]+/, "");
  return (
    comment.value.startsWith("!") ||
    /@(jest|vitest)-environment/.test(comment.value) ||
    TOOL_DIRECTIVE.test(body) ||
    (comment.type === "Block" && BLOCK_ONLY_DIRECTIVE.test(body))
  );
};

const issueLinkedCommentsRule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      issueless:
        "Comments must link the GitHub issue that records the decision (https://github.com/OWNER/REPO/issues/N). Express everything else through names, types, and tests.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const isStandaloneLine = (comment) =>
      comment.type === "Line" &&
      sourceCode.lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column).trim() === "";
    return {
      Program() {
        const groups = [];
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          const group = groups.at(-1);
          const previous = group?.at(-1);
          if (
            previous &&
            isStandaloneLine(previous) &&
            isStandaloneLine(comment) &&
            comment.loc.start.line === previous.loc.end.line + 1
          ) {
            group.push(comment);
          } else {
            groups.push([comment]);
          }
        }
        for (const group of groups) {
          if (group.some((comment) => GITHUB_ISSUE_URL.test(comment.value))) continue;
          for (const comment of group) {
            if (!isToolDirective(comment)) {
              context.report({ loc: comment.loc, messageId: "issueless" });
            }
          }
        }
      },
    };
  },
};

const copilotLintPlugin = {
  rules: {
    "no-direct-node-imports": noDirectNodeImportsRule,
    "issue-linked-comments": issueLinkedCommentsRule,
  },
};

const OBSIDIANMD_UNRATCHETED = new Set([
  "settings-tab/prefer-setting-definitions",
  "ui/sentence-case",
  "platform",
  "rule-custom-message",
]);

const OBSIDIANMD_RATCHET = Object.fromEntries(
  Object.entries(
    (Array.isArray(obsidianmd.configs.recommended)
      ? obsidianmd.configs.recommended
      : [obsidianmd.configs.recommended]
    ).reduce((rules, block) => Object.assign(rules, block.rules), {})
  )
    .filter(([id]) => id.startsWith("obsidianmd/"))
    .filter(([, severity]) => severity !== "off" && severity !== 0)
    .filter(([id]) => !OBSIDIANMD_UNRATCHETED.has(id.slice("obsidianmd/".length)))
    .map(([id]) => [id, "error"])
);

const restrictedSourceImports = [
  {
    selector:
      "ImportDeclaration[source.value=/^\\.\\.($|\\u002f)/], ImportExpression[source.value=/^\\.\\.($|\\u002f)/]",
    message:
      "Parent-relative imports (`../foo`) are banned. Use the `@/` path alias (e.g. `@/components/Foo`) instead.",
  },
  {
    selector:
      "ImportDeclaration[source.value='react-dom/client'] ImportSpecifier[imported.name='createRoot']",
    message:
      "Use createPluginRoot from '@/utils/react/createPluginRoot' instead. It wraps the root in <AppContext.Provider> so descendants can rely on useApp() unconditionally (see PR #2466).",
  },
];

// Named `z` imports pull Zod's locale registry into main.js: https://github.com/Brevilabs/obsidian-copilot-private/issues/94
const restrictedZodSourceImport = {
  selector:
    "ImportDeclaration[source.value='zod'][importKind='value'] ImportSpecifier[imported.name='z'][importKind='value'], ImportDeclaration[source.value='zod/v4'][importKind='value'] ImportSpecifier[imported.name='z'][importKind='value']",
  message:
    'Use `import * as z from "zod"` so the production bundle can tree-shake unused Zod locales.',
};

const restrictedBrowserStorage = {
  selector:
    "Identifier[name=/^(localStorage|sessionStorage)$/], " +
    "MemberExpression[computed=true] > Literal.property[value=/^(localStorage|sessionStorage)$/], " +
    "ObjectPattern > Property > Literal.key[value=/^(localStorage|sessionStorage)$/]",
  message:
    "Use Obsidian's vault-scoped storage through app.loadLocalStorage() / app.saveLocalStorage() instead of raw browser storage.",
};

const restrictedConsoleCalls = [
  {
    selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
    message: "Use logInfo() from '@/logger' instead of console.log().",
  },
  {
    selector: "CallExpression[callee.object.name='console'][callee.property.name='warn']",
    message: "Use logWarn() from '@/logger' instead of console.warn().",
  },
  {
    selector: "CallExpression[callee.object.name='console'][callee.property.name='error']",
    message: "Use logError() from '@/logger' instead of console.error().",
  },
  {
    selector: "CallExpression[callee.object.name='console'][callee.property.name='debug']",
    message: "Use logInfo() from '@/logger' instead of console.debug().",
  },
];

export default [
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "styles.css",
      "dev/gallery/main.js",
      "dev/gallery/styles.css",
      "data.json",
      "designdocs/**",
      "docs/**",
      ".claude/**",
    ],
  },

  ...obsidianmd.configs.recommended,

  {
    files: ["**/*.{jsx,tsx}"],
    ...eslintReact.configs.recommended,
  },
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {
      "@eslint-react/hooks-extra/no-direct-set-state-in-use-effect": "warn",
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  ...tailwind.configs["flat/recommended"].map((cfg) => ({
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ...cfg,
  })),

  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        app: "readonly",
      },
    },
    settings: {
      "react-x": { version: "detect" },
      tailwindcss: {
        callees: ["classnames", "clsx", "ctl", "cn", "cva"],
        config: "./tailwind.config.js",
        cssFiles: ["**/*.css", "!**/node_modules", "!**/.*", "!**/dist", "!**/build"],
        whitelist: ["clickable-icon", "mod-cta"],
      },
    },
    rules: {
      "no-prototype-builtins": "off",
      "obsidianmd/rule-custom-message": [
        "error",
        {
          "no-new-func": {
            messages: {
              "The Function constructor is eval":
                "Using the `Function` constructor is dangerous because it executes arbitrary code, similar to `eval()`",
            },
          },
        },
      ],
      "tailwindcss/classnames-order": "error",
      "tailwindcss/enforces-negative-arbitrary-values": "error",
      "tailwindcss/enforces-shorthand": "error",
      "tailwindcss/migration-from-tailwind-2": "error",
      "tailwindcss/no-arbitrary-value": "off",
      "tailwindcss/no-custom-classname": "error",
      "tailwindcss/no-contradicting-classname": "error",

      "obsidianmd/ui/sentence-case": "off",

      "obsidianmd/platform": "off",

      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",

      "@typescript-eslint/no-deprecated": "off",

      "no-restricted-globals": [
        "error",
        {
          name: "app",
          message:
            "Don't use the global `app` (footgun in popouts). Thread `app` via useApp() or a parameter. See designdocs/agents/PLUGIN_DEV_GUIDE.md.",
        },
      ],

      "no-restricted-properties": [
        "error",
        {
          object: "Platform",
          property: "isDesktopApp",
          message:
            "Use isDesktopRuntime() from @/utils/desktopRuntime instead. Platform.isDesktopApp stays true under app.emulateMobile(true) (Node stubbed to null), so desktop-only/Node code still runs there and crashes.",
        },
      ],
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/__mocks__/**"],
    plugins: { copilot: copilotLintPlugin },
    rules: {
      "copilot/no-direct-node-imports": "error",
    },
  },

  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: { copilot: copilotLintPlugin },
    rules: {
      "copilot/issue-linked-comments": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/utils/react/createPluginRoot.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSourceImports,
        restrictedZodSourceImport,
        restrictedBrowserStorage,
        ...restrictedConsoleCalls,
      ],
    },
  },

  {
    files: ["src/utils/react/createPluginRoot.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        restrictedZodSourceImport,
        restrictedBrowserStorage,
        ...restrictedConsoleCalls,
      ],
    },
  },

  {
    files: ["dev/gallery/**/*.{ts,tsx}"],
    ignores: ["dev/gallery/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", restrictedBrowserStorage],
    },
  },

  {
    files: ["src/**/*.test.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSourceImports],
    },
  },

  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/*",
                "!@/components",
                "!@/components/ui",
                "!@/components/ui/*",
                "!@/lib",
                "!@/lib/*",
                "!@/constants",
              ],
              allowTypeImports: true,
              message:
                "src/components/ui must not import values outside @/components/ui, @/lib, " +
                "and @/constants. Type-only imports are always fine. If a primitive needs " +
                "plugin state, take it as a prop; if it needs a helper, move the helper to " +
                "@/lib. Reaching into @/settings, @/aiParams, @/utils, or @/agentMode couples " +
                "a presentational component to the plugin runtime and makes it unrenderable " +
                "and untestable in isolation.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["dev/gallery/**/*.{ts,tsx}", "src/**/*.stories.{ts,tsx}"],
    ignores: ["dev/gallery/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              allowTypeImports: true,
              message:
                "Gallery runtime and stories may not bypass the production import fence " +
                "with parent-relative value imports. Use an allowed @/ path instead.",
            },
            {
              regex:
                "^@/(?!(?:(?:.*/)?ui/|components/modals/ReactModal$|" +
                "components/gallery-hosts\\.fixtures$|context$|lib/[^/]+$|" +
                "utils/react/mountPluginViewRoot$)).*",
              allowTypeImports: true,
              message:
                "The gallery may only import production values from UI primitives, " +
                "shared libraries, and its explicit Obsidian host/provider seams. " +
                "Type-only imports are always fine. If a component needs plugin state " +
                "to render, pass that state as story data instead of widening this boundary.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.test.{js,jsx,ts,tsx}", "jest.setup.js", "__mocks__/**"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      "import/no-nodejs-modules": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-create-el": "off",
      "eslint-comments/disable-enable-pair": "off",
      "eslint-comments/no-restricted-disable": "off",
      "eslint-comments/require-description": "off",
      "no-restricted-globals": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "boundaries/dependencies": "off",
      "no-restricted-imports": "off",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
    },
  },

  {
    files: [
      "*.{js,mjs,cjs}",
      "scripts/**",
      "dev/gallery/esbuild.config.mjs",
      "esbuild.config.mjs",
      "version-bump.mjs",
      "wasmPlugin.mjs",
      "nodeModuleShim.mjs",
      "jest.config.js",
      "tailwind.config.js",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "import/no-nodejs-modules": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "eslint-comments/disable-enable-pair": "off",
      "eslint-comments/no-restricted-disable": "off",
      "eslint-comments/require-description": "off",
      "obsidianmd/rule-custom-message": "off",
    },
  },

  {
    files: [
      "**/*.cjs",
      "scripts/patchRendererUnsafeUnref.js",
      "scripts/bundleSizeGuard.js",
      "scripts/bundleSizeGuard.test.js",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
        node: true,
      },
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "registry", pattern: "src/agentMode/backends/registry.ts", mode: "file" },
        { type: "barrel", pattern: "src/agentMode/index.ts", mode: "file" },
        { type: "session", pattern: "src/agentMode/session" },
        { type: "acp", pattern: "src/agentMode/acp" },
        { type: "sdk", pattern: "src/agentMode/sdk" },
        { type: "backend", pattern: "src/agentMode/backends/*", capture: ["name"] },
        { type: "ui", pattern: "src/agentMode/ui" },
        { type: "skills", pattern: "src/agentMode/skills" },
        { type: "modelmgmt", pattern: "src/modelManagement" },
        { type: "host", pattern: "src/**" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: { type: "session" }, allow: { to: { type: ["session", "host"] } } },
            { from: { type: "acp" }, allow: { to: { type: ["acp", "session", "host"] } } },
            { from: { type: "sdk" }, allow: { to: { type: ["sdk", "session", "host"] } } },
            {
              from: { type: "backend" },
              allow: [
                { to: { type: ["acp", "sdk", "session", "skills", "modelmgmt", "host"] } },
                { to: { type: "backend", captured: { name: "{{from.captured.name}}" } } },
                { to: { type: "backend", captured: { name: "shared" } } },
              ],
            },
            { from: { type: "registry" }, allow: { to: { type: ["backend", "session", "host"] } } },
            {
              from: { type: "ui" },
              allow: {
                to: { type: ["ui", "session", "registry", "skills", "host"] },
              },
            },
            {
              from: { type: "skills" },
              allow: { to: { type: ["skills", "session", "host", "registry"] } },
            },
            {
              from: { type: "barrel" },
              allow: {
                to: {
                  type: ["acp", "session", "sdk", "backend", "registry", "ui", "skills", "host"],
                },
              },
            },
            { from: { type: "modelmgmt" }, allow: { to: { type: ["modelmgmt", "host"] } } },
            {
              from: { type: "host" },
              allow: { to: { type: ["host", "barrel", "modelmgmt"] } },
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.test.{js,jsx,ts,tsx}", "jest.setup.js", "__mocks__/**"],
    rules: {
      "boundaries/dependencies": "off",
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@agentclientprotocol/sdk",
              message:
                "ACP wire types are confined to src/agentMode/acp/. session/, sdk/, ui/, backends/, and skills/ should depend on the session-domain types in @/agentMode/session/types instead. See src/agentMode/AGENTS.md.",
            },
          ],
          patterns: [
            {
              group: ["@/modelManagement/*"],
              message:
                "Import from @/modelManagement (the barrel) only. Deep imports of @/modelManagement/types/* are not allowed from outside the module. See src/modelManagement/AGENTS.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/agentMode/acp/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/modelManagement/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { inheritedMethods: false } },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/unbound-method": "error",
      ...OBSIDIANMD_RATCHET,
      "no-undef": "off",
    },
  },

  {
    files: ["src/agentMode/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  {
    ignores: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/no-plugin-as-component": "off",
    },
  },

  {
    files: ["**/package.json"],
    rules: {
      "depend/ban-dependencies": [
        "error",
        {
          presets: ["native", "microutilities", "preferred"],
        },
      ],
    },
  },

  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
];
