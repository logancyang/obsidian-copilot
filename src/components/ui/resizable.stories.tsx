import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type ResizablePanelGroupProps = React.ComponentProps<typeof ResizablePanelGroup>;

const meta = {
  title: "UI/Resizable",
  component: ResizablePanelGroup,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ResizablePanelGroupProps>;
export default meta;

const PanelBody: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => (
  <div className="tw-flex tw-h-full tw-flex-col tw-gap-2 tw-p-3">
    <div className="tw-text-ui-small tw-font-medium">{title}</div>
    {lines.map((line) => (
      <div key={line} className="tw-truncate tw-text-ui-small tw-text-muted">
        {line}
      </div>
    ))}
  </div>
);

export const SidebarSplit: StoryObj<ResizablePanelGroupProps> = {
  render: () => (
    <div className="tw-flex tw-h-80 tw-rounded-md tw-border tw-border-solid tw-border-border">
      <ResizablePanelGroup orientation="horizontal" className="tw-flex-1">
        <ResizablePanel defaultSize="30%" minSize="20%" maxSize="40%">
          <PanelBody title="Groups" lines={["Notes", "Web pages", "YouTube"]} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="70%">
          <PanelBody
            title="Items"
            lines={["projects/launch-plan.md", "projects/research/interviews.md"]}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};
