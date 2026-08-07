import type { Meta, StoryObj } from "@/lib/story";
import { Cog, Cpu, Sigma } from "lucide-react";
import * as React from "react";
import { TabContent, TabItem, type TabVariant } from "./setting-tabs";

const TABS = [
  { id: "basic", label: "Basic", icon: <Cog className="tw-size-5" /> },
  { id: "models", label: "Models", icon: <Cpu className="tw-size-5" /> },
  { id: "miyo", label: "Miyo", icon: <Sigma className="tw-size-5" /> },
];

type TabItemProps = React.ComponentProps<typeof TabItem>;

/** A whole strip plus its panel — the unit a reader actually judges the variant by. */
const Strip: React.FC<{ variant: TabVariant; labels?: string[] }> = ({ variant, labels }) => {
  const tabs = labels ? labels.map((label, i) => ({ id: `t${i}`, label, icon: null })) : TABS;
  const [selected, setSelected] = React.useState(tabs[0].id);
  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-flex tw-flex-wrap tw-gap-1" role="tablist">
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isSelected={selected === tab.id}
            onClick={() => setSelected(tab.id)}
            isFirst={index === 0}
            isLast={index === tabs.length - 1}
            variant={variant}
          />
        ))}
      </div>
      <TabContent id={selected} isSelected variant={variant}>
        <div className="tw-rounded-md tw-bg-primary tw-p-4 tw-text-sm">Panel for {selected}</div>
      </TabContent>
    </div>
  );
};

const meta = {
  title: "UI/Setting Tabs",
  component: TabItem,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<TabItemProps>;
export default meta;

/** Pane-edge strip: rounded at the top only, and its panel paints the grey backdrop. */
export const PageVariant: StoryObj<TabItemProps> = {
  render: () => <Strip variant="page" />,
};

/** Nested chips: uniformly rounded, accent outline when selected, no second backdrop. */
export const InlineVariant: StoryObj<TabItemProps> = {
  render: () => <Strip variant="inline" />,
};

/**
 * The real Agents strip: four tabs whose labels are long enough to wrap once the
 * canvas is narrow. Narrow the gallery's width toolbar over this one — a story
 * cannot pin a width, so the fixture supplies the content and the toolbar
 * supplies the boundary.
 */
export const LongLabels: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Strip variant="page" labels={["OpenCode", "Claude", "Codex", "Quick Chat"]} />
      <Strip variant="inline" labels={["OpenCode", "Claude", "Codex", "Quick Chat"]} />
    </div>
  ),
};
