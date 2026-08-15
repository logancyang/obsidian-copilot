import obsidianmd from "eslint-plugin-obsidianmd";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import tailwind from "eslint-plugin-tailwindcss";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";

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

  // obsidianmd recommended brings:
  //   - eslint:recommended
  //   - typescript-eslint recommendedTypeChecked on .ts/.tsx (recommended on .js/.jsx)
  //   - obsidianmd plugin + all obsidianmd-namespaced rules
  //   - import / @microsoft/sdl / depend / no-unsanitized
  //   - Obsidian-injected globals (activeDocument, createDiv, etc.)
  ...obsidianmd.configs.recommended,

  // React + tailwind plugins ship flat configs with no `files` filter, so
  // they'd cascade onto package.json (which uses the JSON parser) and crash.
  // Constrain them to JSX/TSX sources where React/JSX rules actually apply.
  {
    files: ["**/*.{jsx,tsx}"],
    ...eslintReact.configs.recommended,
  },
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {
      // Deferred to follow-up PRs — these flag legitimate anti-patterns but
      // each fix requires per-component intent analysis, and they're surfaced
      // as warnings (not errors) so they don't block CI.
      //
      // no-direct-set-state-in-use-effect: ~50 violations. Common pattern is
      // "sync local state with prop", which has no one-size-fits-all fix —
      // some cases want render-time derivation, others want a `key` prop reset
      // or `useSyncExternalStore`. Refactoring blindly risks behavior regressions
      // in the chat UI's stateful components.
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
        // Obsidian plugin runtime injects `app` as a global (see CLAUDE.md).
        app: "readonly",
      },
    },
    settings: {
      "react-x": { version: "detect" },
      tailwindcss: {
        callees: ["classnames", "clsx", "ctl", "cn", "cva"],
        config: "./tailwind.config.js",
        cssFiles: ["**/*.css", "!**/node_modules", "!**/.*", "!**/dist", "!**/build"],
        // Obsidian-provided utility classes used in JSX but not defined in our CSS.
        whitelist: ["clickable-icon"],
      },
    },
    rules: {
      // Carry-over from legacy .eslintrc
      "no-prototype-builtins": "off",
      // Use project-specific console-call messages below while preserving the
      // Obsidian config's custom message for the Function constructor.
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

      // obsidianmd: defer to follow-up PRs
      "obsidianmd/ui/sentence-case": "off",

      // obsidianmd: disabled intentionally — Platform.isMacOS branching is on-purpose
      "obsidianmd/platform": "off",

      // Bundled by obsidianmd/recommended via tseslint.configs.recommendedTypeChecked.
      // Disabled here because the codebase intentionally uses `any` / dynamic typing
      // around Obsidian's untyped APIs and LangChain message shapes — flipping these
      // on would require refactoring thousands of call sites with no functional gain.
      //
      // Violation counts (src/**/*.{ts,tsx}) are noted inline. Rules with low counts
      // are candidates to enable in small follow-up PRs.

      // --- Heavy: any-flow through Obsidian/LangChain APIs ---
      // no-unsafe-member-access: enabled globally; tests are exempted via the
      // test-file override below.
      "@typescript-eslint/no-unsafe-assignment": "off", // enabled for tests below; follow-up PR for production
      "@typescript-eslint/no-unsafe-call": "off", // 107 violations

      // --- Medium: promise / method ergonomics ---
      // Enabled in the TS-only block below.

      // no-deprecated: defer — surface the warnings, but don't fail CI yet
      "@typescript-eslint/no-deprecated": "off",

      // Ban the Obsidian-injected global `app` (footgun in popouts; hides
      // dependencies from tests). Thread `app` via useApp() in React or as a
      // parameter in plain modules. See PLUGIN_DEV_GUIDE.md.
      "no-restricted-globals": [
        "error",
        {
          name: "app",
          message:
            "Don't use the global `app` (footgun in popouts). Thread `app` via useApp() or a parameter. See designdocs/agents/PLUGIN_DEV_GUIDE.md.",
        },
      ],

      // Ban `Platform.isDesktopApp` — it stays true under
      // `app.emulateMobile(true)` (which stubs Node's built-ins to null), so
      // desktop-only / Node-dependent code still runs there and crashes the
      // plugin. Gate on isDesktopRuntime() (desktop app AND not mobile) instead.
      // The helper itself (src/utils/desktopRuntime.ts) is exempt via an inline
      // disable, since it owns the canonical check.
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

  // Two AST-level import bans, combined in one block:
  //
  // 1. Parent-relative imports (`../foo`, `..`) — use the `@/` path alias
  //    instead. Survives file moves, keeps grep unambiguous, avoids long
  //    `../../../` chains. Same-directory `./foo` remains allowed.
  //
  // 2. `createRoot` from `react-dom/client` outside `createPluginRoot` —
  //    every standalone React root must go through that helper so descendants
  //    can rely on `useApp()` unconditionally (bug class fixed in PR #2466).
  //
  // Both selectors must live in the same block: flat config replaces (does
  // not merge) rule values when the same rule key appears in multiple
  // matching blocks, so splitting them would silently disable the earlier
  // ban on every file the later block also matches.
  //
  // `createPluginRoot.tsx` is exempted via `ignores` — it owns `createRoot`,
  // and has no parent imports today.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/utils/react/createPluginRoot.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSourceImports, ...restrictedConsoleCalls],
    },
  },

  // createPluginRoot owns the otherwise-restricted React root import, but it
  // still belongs to the production logging boundary.
  {
    files: ["src/utils/react/createPluginRoot.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedConsoleCalls],
    },
  },

  // Test output is intentionally written to the console. Keep the production
  // import restrictions without applying the logging boundary to test files.
  {
    files: ["src/**/*.test.{js,jsx,ts,tsx}", "src/integration_tests/**"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSourceImports],
    },
  },

  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    // Tests may reach further; stories deliberately may not — a story that needs
    // plugin state to build a fixture is reporting a coupled component.
    ignores: ["src/components/ui/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Allowlist, not denylist: almost every src/ directory holds a store or
              // singleton somewhere, so enumerating the bad ones will always lag.
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
    // Test fixtures intentionally import production stories and contexts but are
    // erased from the gallery bundle, so only runtime gallery code needs this fence.
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

  // Test files need Jest globals
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
      // Tests intentionally consume the global `app` mock (window.app, set up in
      // __mocks__/obsidian.js) to feed it into the parameterized production
      // functions under test. The footgun the ban guards against (popout windows,
      // hidden dependencies) is a production concern, so don't enforce it here.
      "no-restricted-globals": "off",
      // Tests use intentional `any` mocks; disable type-safety rules that flood
      // the test suite without adding signal.
      "@typescript-eslint/no-unsafe-member-access": "off",
      // Tests freely reach across layers and import ACP wire types directly to
      // build fixtures; the layer enforcement only applies to production code.
      "boundaries/dependencies": "off",
      "no-restricted-imports": "off",
    },
  },

  // Tests have been cleaned of unsafe `any` assignments. Production code
  // (~499 violations) is a follow-up; keep tests enforced.
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
    },
  },

  // Integration tests bootstrap jsdom fetch via `node-fetch` polyfill —
  // allow the otherwise-banned import here only.
  {
    files: ["src/integration_tests/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Node-context files (build configs, scripts)
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

  // CommonJS tools use require() by construction. The renderer patch also
  // runs only from the Node build pipeline despite its historical .js suffix.
  {
    files: ["**/*.cjs", "scripts/patchRendererUnsafeUnref.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Agent Mode: backends spawn subprocesses (ACP) and the in-process Claude
  // SDK uses node:async_hooks. The plugin runs in Electron renderer where
  // these modules are available; the desktop-only Agent Mode is also gated by
  // `Platform.isMobile` at runtime in main.ts. The Symposium handoff consumer
  // is likewise desktop-only, but remains in the host publishing layer.
  // openVaultPath lazy-requires node:fs behind a desktop vault-base guard,
  // mirroring opencodeLog. Modules converted to call-time
  // `requireNodeModule()` guards (see src/utils/desktopRuntime.ts) need no
  // exemption.
  {
    files: [
      "src/agentMode/**",
      "src/utils/issueReport.ts",
      "src/utils/opencodeLog.ts",
      "src/utils/openVaultPath.ts",
      "src/symposium/symposiumAgentHandoff.ts",
    ],
    rules: {
      "import/no-nodejs-modules": "off",
    },
  },

  // Element types (order matters — first match wins; files before folders):
  //   registry     src/agentMode/backends/registry.ts (file)
  //   barrel       src/agentMode/index.ts (file)
  //   session      src/agentMode/session
  //   acp          src/agentMode/acp
  //   sdk          src/agentMode/sdk
  //   backend      src/agentMode/backends/<name>
  //   ui           src/agentMode/ui
  //   skills       src/agentMode/skills
  //   host         src/** (everything else under src/)
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    plugins: { boundaries },
    settings: {
      // Required so `eslint-plugin-boundaries` can resolve `@/*` path aliases
      // to their `src/*` targets.
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
            // modelManagement: self-contained module. Host code may
            // freely reach into the module at the boundary layer; the
            // barrel-only entry rule (no deep imports of
            // `@/modelManagement/types/*`) is enforced by
            // `no-restricted-imports` patterns further down.
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

  // Re-disable boundaries/dependencies for tests — the block above otherwise
  // re-enables the rule for test files via the broader `src/**` pattern.
  {
    files: ["**/*.test.{js,jsx,ts,tsx}", "jest.setup.js", "__mocks__/**"],
    rules: {
      "boundaries/dependencies": "off",
    },
  },

  // Two path-based import fences, combined in one block (flat config
  // replaces — does not merge — rule values when the same rule key
  // appears across matching blocks, so both fences MUST live here):
  //
  //   1. `@agentclientprotocol/sdk` — confined to src/agentMode/acp/.
  //      Other agent-mode layers depend on the session-domain types
  //      in @/agentMode/session/types instead.
  //   2. `@/modelManagement/*` deep imports — host code must enter the
  //      modelManagement module via its barrel (`@/modelManagement`).
  //      This replaces a `modelmgmt-barrel` boundary element with the
  //      lighter no-restricted-imports mechanism already used for (1).
  //
  // Module-internal files are exempted in the override blocks below.
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

  // TypeScript-specific overrides (the @typescript-eslint plugin is registered
  // by obsidianmd's recommended config only for .ts/.tsx files).
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
      // checksVoidReturn relaxed for:
      //   - attributes: async event handlers in JSX (onClick={async () => ...}) are
      //     the standard React pattern; React already handles them correctly.
      //   - inheritedMethods: Obsidian's Plugin.onload/onunload are commonly async.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false, inheritedMethods: false } },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/unbound-method": "error",
      // TypeScript handles undefined-identifier detection (and does so cross-realm
      // correctly); per typescript-eslint's own guidance, disable no-undef on TS.
      "no-undef": "off",
    },
  },

  // Agent Mode tests use heavy `any` mocking for backend / SDK / ACP wire
  // types whose real shapes are vendor-controlled and inconvenient to model
  // in test scaffolding. Loosen the test-only unsafe rules for the
  // agent-mode subtree only; production code stays enforced. Placed after the
  // general TS block so it actually overrides.
  {
    files: ["src/agentMode/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  // Non-TS files aren't in tsconfig.json — disable type-aware rules that
  // obsidianmd's recommended config enables globally. Most typed obsidianmd
  // rules are already gated to **/*.ts(x); only no-plugin-as-component leaks
  // out via recommendedPluginRulesConfig, and @typescript-eslint/no-deprecated
  // is enabled globally.
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx", "**/package.json"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/no-plugin-as-component": "off",
    },
  },

  // package.json: keep depend/ban-dependencies enabled from obsidianmd's
  // recommended config and make deliberate dependency choices explicit here.
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

  // Jest assertions like `expect(mock.method).toHaveBeenCalled()` reference
  // methods unbound by design. The rule has no clean workaround for jest
  // patterns (binding changes the reference identity and breaks the assertion),
  // so disable it in tests. Scoped to .ts/.tsx because the @typescript-eslint
  // plugin is only registered for those files. Placed last so it overrides the
  // TS-only block above.
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
];
