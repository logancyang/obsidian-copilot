import type { ApprovedRule, ApprovedRuleStore } from "@/agentMode";
import type { Meta, StoryObj } from "@/lib/story";
import type CopilotPlugin from "@/main";
import React from "react";
import { ApprovedRulesPage, type ApprovedRulesPageProps } from "./ApprovedRulesPage";

const RULES: ReadonlyArray<ApprovedRule> = [
  { id: "git-status", allows: "Bash(git status:*)", appliesTo: { kind: "agent" } },
  {
    id: "npm-test",
    allows: "Bash(npm run test:*)",
    appliesTo: { kind: "folder", path: "/Users/alex/Documents/Research vault" },
  },
  {
    id: "web-fetch",
    allows: "WebFetch(domain:docs.obsidian.md)",
    appliesTo: {
      kind: "file",
      path: "/Users/alex/Documents/Research vault/.claude/settings.local.json",
    },
  },
  {
    id: "edit-notes",
    allows: "Edit(/Users/alex/Documents/Research vault/Projects/2026 Field Notes/**)",
    appliesTo: { kind: "file", path: "/Users/alex/.claude/settings.json" },
  },
];

function fakeRuleStore(overrides: Partial<ApprovedRuleStore> = {}): ApprovedRuleStore {
  return {
    list: async () => RULES,
    remove: async () => undefined,
    ...overrides,
  };
}

const PLUGIN = {} as CopilotPlugin;

const MANY_RULES: ReadonlyArray<ApprovedRule> = Array.from({ length: 30 }, (_, index) => ({
  id: `rule-${index}`,
  allows: `Bash(tool${index + 1}:*)`,
  appliesTo: { kind: "agent" },
}));

function InSettingsViewport(args: Partial<ApprovedRulesPageProps>): React.ReactElement {
  return (
    <div className="tw-h-[480px]">
      <ApprovedRulesPage {...meta.args} {...args} />
    </div>
  );
}

function typeSearch(root: HTMLElement, text: string): boolean {
  const input = root.querySelector<HTMLInputElement>('input[placeholder="Search approved rules…"]');
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function SearchedPage({ text }: { text: string }): React.ReactElement {
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (typeSearch(el, text)) observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [text]);
  return (
    <div ref={root} className="tw-h-[480px]">
      <ApprovedRulesPage
        agentName="Claude"
        store={fakeRuleStore()}
        plugin={PLUGIN}
        onBack={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: "Settings/Approved Rules Page",
  component: ApprovedRulesPage,
  args: {
    agentName: "Claude",
    store: fakeRuleStore(),
    plugin: PLUGIN,
    onBack: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ApprovedRulesPageProps>;
export default meta;

export const Populated: StoryObj<ApprovedRulesPageProps> = { render: InSettingsViewport };

export const ManyRules: StoryObj<ApprovedRulesPageProps> = {
  args: { store: fakeRuleStore({ list: async () => MANY_RULES }) },
  render: InSettingsViewport,
};

export const Loading: StoryObj<ApprovedRulesPageProps> = {
  render: InSettingsViewport,
  args: { store: fakeRuleStore({ list: () => new Promise(() => undefined) }) },
};

export const Empty: StoryObj<ApprovedRulesPageProps> = {
  render: InSettingsViewport,
  args: { store: fakeRuleStore({ list: async () => [] }) },
};

export const SearchWithNoMatch: StoryObj<ApprovedRulesPageProps> = {
  render: () => <SearchedPage text="curl" />,
};

export const CantRead: StoryObj<ApprovedRulesPageProps> = {
  render: InSettingsViewport,
  args: {
    store: fakeRuleStore({
      list: async () => {
        throw new Error("Unexpected token } in JSON at position 412 (~/.claude/settings.json)");
      },
    }),
  },
};

export const RemoveError: StoryObj<ApprovedRulesPageProps> = {
  render: InSettingsViewport,
  args: {
    store: fakeRuleStore({
      remove: async () => {
        throw new Error("EACCES: permission denied, open '/Users/alex/.claude/settings.json'");
      },
    }),
  },
};
