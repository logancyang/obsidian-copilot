import { Button } from "@/components/ui/button";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { SettingsSubPageLayout, type SettingsSubPageLayoutProps } from "./SettingsSubPageLayout";

function Rows({ count }: { count: number }): React.ReactElement {
  return (
    <ul aria-label="Items" className="tw-m-0 tw-list-none tw-p-0">
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          className={cn(
            "tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-3",
            index > 0 && "copilot-divider-t"
          )}
        >
          <div className="tw-min-w-0">
            <div className="tw-break-words tw-text-sm">Item {index + 1}</div>
            <div className="tw-text-xs tw-text-muted">Secondary detail for item {index + 1}</div>
          </div>
          <Button variant="secondary" size="sm">
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SettingsViewport({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="tw-h-[480px]">{children}</div>;
}

const meta = {
  title: "Settings/Settings Sub-Page Layout",
  component: SettingsSubPageLayout,
  args: {
    title: "Approved rules",
    description:
      "Actions Claude may take without asking, saved when you chose an “always” option. Remove a rule to have Claude ask again.",
    onBack: () => undefined,
    children: null,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SettingsSubPageLayoutProps>;
export default meta;

export const ShortContent: StoryObj<SettingsSubPageLayoutProps> = {
  render: () => (
    <SettingsViewport>
      <SettingsSubPageLayout
        {...meta.args}
        toolbar={<SearchBar value="" onChange={() => undefined} placeholder="Search…" />}
      >
        <Rows count={3} />
      </SettingsSubPageLayout>
    </SettingsViewport>
  ),
};

export const FiftyItems: StoryObj<SettingsSubPageLayoutProps> = {
  render: () => (
    <SettingsViewport>
      <SettingsSubPageLayout
        {...meta.args}
        title="Browse connectors"
        description="Connect a service so agents can use it in chats."
        titleAction={
          <ObsidianNativeSelect
            aria-label="Category"
            containerClassName="tw-w-40"
            defaultValue="all"
            options={[
              { label: "All categories", value: "all" },
              { label: "Productivity", value: "productivity" },
            ]}
          />
        }
        toolbar={<SearchBar value="" onChange={() => undefined} placeholder="Search…" />}
        footer={
          <div className="tw-text-sm tw-text-muted">
            Don&apos;t see your service? Request a connector.
          </div>
        }
      >
        <Rows count={50} />
      </SettingsSubPageLayout>
    </SettingsViewport>
  ),
};
