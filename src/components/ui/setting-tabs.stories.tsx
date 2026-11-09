import type { Meta, StoryObj } from "@/lib/story";
import { Command, Cog, Cpu, Plug, ShieldCheck, Sigma, Sparkle, Wrench } from "lucide-react";
import * as React from "react";
import { SettingTabStrip, TabContent, TabItem, type TabVariant } from "./setting-tabs";

const TABS = [
  { id: "basic", label: "Basic", icon: <Cog className="tw-size-5" /> },
  { id: "models", label: "Models", icon: <Cpu className="tw-size-5" /> },
  { id: "miyo", label: "Miyo", icon: <Sigma className="tw-size-5" /> },
];

type TabItemProps = React.ComponentProps<typeof TabItem>;

const ALL_SETTINGS_TABS = [
  { id: "basic", label: "Basic", icon: <Cog className="tw-size-5" /> },
  { id: "byok", label: "BYOK", icon: <Cpu className="tw-size-5" /> },
  { id: "miyo", label: "Miyo", icon: <Sigma className="tw-size-5" /> },
  { id: "selfhost", label: "Self-Host", icon: <ShieldCheck className="tw-size-5" /> },
  { id: "command", label: "Commands", icon: <Command className="tw-size-5" /> },
  {
    id: "skills",
    label: "Skills",
    icon: <Sparkle className="tw-size-5" />,
    warningLabel: "Some skills failed to load",
  },
  {
    id: "connectors",
    label: "Connectors",
    icon: <Plug className="tw-size-5" />,
    warningLabel: "You have connectors that need your attention",
    warningTone: "error" as const,
  },
  { id: "advanced", label: "Advanced", icon: <Wrench className="tw-size-5" /> },
];

interface StripProps {
  variant: TabVariant;
  tabs?: React.ComponentProps<typeof SettingTabStrip>["tabs"];
  initialId?: string;
}

const Strip: React.FC<StripProps> = ({ variant, tabs = TABS, initialId = tabs[0].id }) => {
  const [selected, setSelected] = React.useState(initialId);
  return (
    <div className="tw-flex tw-flex-col">
      <SettingTabStrip tabs={tabs} selectedId={selected} onSelect={setSelected} variant={variant} />
      <TabContent id={selected} isSelected variant={variant}>
        <div className="tw-rounded-md tw-bg-primary tw-p-4 tw-text-sm">Panel for {selected}</div>
      </TabContent>
    </div>
  );
};

const labelTabs = (labels: string[]) =>
  labels.map((label, i) => ({ id: `t${i}`, label, icon: null }));

const meta = {
  title: "UI/Setting Tabs",
  component: TabItem,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<TabItemProps>;
export default meta;

export const PageVariant: StoryObj<TabItemProps> = {
  render: () => <Strip variant="page" />,
};

export const InlineVariant: StoryObj<TabItemProps> = {
  render: () => <Strip variant="inline" />,
};

export const WarningDot: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-gap-2">
      <TabItem
        tab={{
          id: "skills-idle",
          label: "Skills",
          icon: <Sparkle className="tw-size-5" />,
          warningLabel: "Some skills failed to load",
        }}
        isSelected={false}
        onClick={() => undefined}
      />
      <TabItem
        tab={{
          id: "skills-selected",
          label: "Skills",
          icon: <Sparkle className="tw-size-5" />,
          warningLabel: "Some skills failed to load",
        }}
        isSelected
        onClick={() => undefined}
      />
    </div>
  ),
};

export const ErrorDot: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-gap-2">
      <TabItem
        tab={{
          id: "connectors-idle",
          label: "Connectors",
          icon: <Plug className="tw-size-5" />,
          warningLabel: "You have connectors that need your attention",
          warningTone: "error",
        }}
        isSelected={false}
        onClick={() => undefined}
      />
      <TabItem
        tab={{
          id: "connectors-selected",
          label: "Connectors",
          icon: <Plug className="tw-size-5" />,
          warningLabel: "You have connectors that need your attention",
          warningTone: "error",
        }}
        isSelected
        onClick={() => undefined}
      />
    </div>
  ),
};

export const LongLabels: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Strip variant="page" tabs={labelTabs(["OpenCode", "Claude", "Codex", "Quick Chat"])} />
      <Strip variant="inline" tabs={labelTabs(["OpenCode", "Claude", "Codex", "Quick Chat"])} />
    </div>
  ),
};

export const OverflowMenu: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Strip variant="page" tabs={ALL_SETTINGS_TABS} />
      <Strip variant="page" tabs={ALL_SETTINGS_TABS} initialId="advanced" />
      <Strip variant="inline" tabs={labelTabs(["OpenCode", "Claude", "Codex", "Quick Chat"])} />
    </div>
  ),
};
