import { GalleryProviders, galleryHostFixtures } from "@/components/gallery-hosts.fixtures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

const meta = {
  title: "Gallery/Host Environments",
} satisfies Meta;
export default meta;

export const DefaultLeaf: StoryObj = {
  parameters: { gallery: { layout: "fullscreen" } },
  render: () => (
    <GalleryProviders>
      <div className="tw-flex tw-flex-col tw-gap-3">
        <div className="tw-flex tw-items-center tw-gap-2">
          <Badge variant="secondary">Provider-backed</Badge>
          <span>Composite stories can opt into shared runtime contexts.</span>
        </div>
        <Button type="button">Continue</Button>
      </div>
    </GalleryProviders>
  ),
};

export const DeleteConfirmation: StoryObj = {
  name: galleryHostFixtures.confirmation.title,
  parameters: { gallery: { host: "modal" } },
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <p className="tw-m-0">{galleryHostFixtures.confirmation.body}</p>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="button" variant="destructive">
          {galleryHostFixtures.confirmation.confirmLabel}
        </Button>
      </div>
    </div>
  ),
};

export const ResponseActions: StoryObj = {
  parameters: { gallery: { host: "popover" } },
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {galleryHostFixtures.popover.description}
      </p>
      {galleryHostFixtures.popover.actions.map((action) => (
        <Button className="tw-justify-start" key={action} type="button" variant="ghost2">
          {action}
        </Button>
      ))}
    </div>
  ),
};

export const ModelPreferences: StoryObj = {
  parameters: { gallery: { host: "settings-tab" } },
  render: () => (
    <SettingItem
      checked
      description={galleryHostFixtures.settings.description}
      onCheckedChange={() => undefined}
      title={galleryHostFixtures.settings.title}
      type="switch"
    />
  ),
};
