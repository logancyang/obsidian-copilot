import {
  ConnectorToolsPage,
  type ConnectorToolsPageProps,
} from "@/connectors/ui/ConnectorToolsPage";
import { FAKE_CUSTOM_TOOLS, NOTION_TOOLS } from "@/connectors/ui/testing/serviceTools";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

interface InteractedProps extends ConnectorToolsPageProps {
  query?: string;
  expandFirst?: boolean;
}

function Interacted({ query, expandFirst, ...props }: InteractedProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = container.current?.querySelector("input");
    if (input && query) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, [query]);
  useEffect(() => {
    if (!expandFirst) return;
    const showMore = () =>
      [...(container.current?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Show more"
      );
    const observer = new MutationObserver(() => {
      const button = showMore();
      if (!button) return;
      observer.disconnect();
      button.click();
    });
    if (container.current) observer.observe(container.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [expandFirst]);
  return (
    <div ref={container} className="tw-h-[560px]">
      <ConnectorToolsPage {...props} />
    </div>
  );
}

const meta = {
  title: "Connectors/Tools Page",
  component: ConnectorToolsPage,
  args: {
    service: {
      name: "Notion",
      logoUrl: "https://images.brevilabs.com/newsletters/copilot-plugin/connectors/notion.png",
    },
    tools: NOTION_TOOLS,
    onTryAgain: async () => undefined,
    onBack: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ConnectorToolsPageProps>;
export default meta;

export const ReadOnlyAndChangingTools: StoryObj<ConnectorToolsPageProps> = {
  render: (args) => <Interacted {...(args as ConnectorToolsPageProps)} />,
};

export const LongDescriptionExpanded: StoryObj<ConnectorToolsPageProps> = {
  render: (args) => <Interacted {...(args as ConnectorToolsPageProps)} expandFirst />,
};

export const Searching: StoryObj<ConnectorToolsPageProps> = {
  render: (args) => <Interacted {...(args as ConnectorToolsPageProps)} query="page" />,
};

export const NoSearchResults: StoryObj<ConnectorToolsPageProps> = {
  render: (args) => <Interacted {...(args as ConnectorToolsPageProps)} query="calendar" />,
};

export const FewToolsWithoutSearch: StoryObj<ConnectorToolsPageProps> = {
  args: { service: { name: "Fake Notes" }, tools: FAKE_CUSTOM_TOOLS },
  render: (args) => <Interacted {...(args as ConnectorToolsPageProps)} />,
};

export const CouldNotReach: StoryObj<ConnectorToolsPageProps> = {
  args: { tools: null },
  render: (args) => <Interacted {...(args as ConnectorToolsPageProps)} />,
};
