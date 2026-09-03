import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import {
  MiyoAvailabilityNotice,
  MiyoConnectionControl,
  type MiyoConnectionControlProps,
} from "./MiyoConnectionControl";

function renderAvailabilityState(args: MiyoConnectionControlProps) {
  const available = args.status === "available" || args.status === "stale";
  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-gap-4">
      <div className="tw-flex tw-justify-end">
        <MiyoConnectionControl {...args} />
      </div>
      <MiyoAvailabilityNotice
        enabled={args.enabled}
        available={available}
        checking={args.checking}
      />
      <div className={available ? undefined : "tw-pointer-events-none tw-opacity-45"}>
        Semantic search and other Miyo-backed settings
      </div>
    </div>
  );
}

const meta = {
  title: "Settings/Miyo Connection",
  component: MiyoConnectionControl,
  args: {
    enabled: true,
    status: "available",
    checking: false,
    remote: false,
    onConnect: () => {},
    onDisconnect: () => {},
    onRetry: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<MiyoConnectionControlProps>;
export default meta;

export const Disconnected: StoryObj<MiyoConnectionControlProps> = {
  args: { enabled: false, status: "unknown" },
  render: renderAvailabilityState,
};

export const Checking: StoryObj<MiyoConnectionControlProps> = {
  args: { checking: true, status: "stale" },
  render: renderAvailabilityState,
};

export const ConnectedLocal: StoryObj<MiyoConnectionControlProps> = {
  render: renderAvailabilityState,
};

export const ConnectedRemote: StoryObj<MiyoConnectionControlProps> = {
  args: { remote: true },
  render: renderAvailabilityState,
};

export const StaleConnection: StoryObj<MiyoConnectionControlProps> = {
  args: { status: "stale" },
  render: renderAvailabilityState,
};

export const Unavailable: StoryObj<MiyoConnectionControlProps> = {
  args: { status: "unavailable" },
  render: renderAvailabilityState,
};
