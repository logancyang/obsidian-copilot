import type { Meta, StoryObj } from "@/lib/story";
import type { RemoteHostViewState } from "@/remote/hostState";
import { RemoteHostPanel, type RemoteHostPanelProps } from "./RemoteHostPanel";

const SAMPLE_LINK =
  "obsidian://copilot-pair?host=100.64.0.7&port=52341&vault=Work+notes&vaultId=3f9a1c2e&secret=k3Jd8sLq0Zt5vXw9bN2mRa7Y";
const NOW = 1_780_000_000_000;

const READY: RemoteHostViewState = {
  plus: true,
  tailscaleAddress: "100.64.0.7",
  listening: false,
  pairing: null,
  devices: [],
  error: null,
};

const meta = {
  title: "Settings/Remote Host Panel",
  component: RemoteHostPanel,
  args: {
    state: READY,
    onStartPairing: () => {},
    onCancelPairing: () => {},
    onCopyLink: () => {},
    onRevoke: () => {},
    onRecheck: () => {},
    onUpgrade: () => {},
    onKeepAwakeModeChange: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<RemoteHostPanelProps>;
export default meta;

export const WithoutPlus: StoryObj<RemoteHostPanelProps> = {
  args: { state: { ...READY, plus: false } },
};

export const WithoutPlusPhonesStillPaired: StoryObj<RemoteHostPanelProps> = {
  args: {
    state: {
      ...READY,
      plus: false,
      devices: [
        {
          id: "a",
          name: "iPhone",
          createdAt: NOW - 86_400_000,
          lastSeenAt: NOW - 3_600_000,
          connected: false,
        },
      ],
    },
  },
};

export const TailscaleNotDetected: StoryObj<RemoteHostPanelProps> = {
  args: { state: { ...READY, tailscaleAddress: null } },
};

export const ReadyToPair: StoryObj<RemoteHostPanelProps> = {};

export const PairingCode: StoryObj<RemoteHostPanelProps> = {
  args: {
    state: {
      ...READY,
      listening: true,
      pairing: { link: SAMPLE_LINK, expiresAt: NOW + 5 * 60 * 1000 },
    },
  },
};

export const PairedPhones: StoryObj<RemoteHostPanelProps> = {
  args: {
    keepAwakeMode: "plugged",
    state: {
      ...READY,
      listening: true,
      devices: [
        {
          id: "a",
          name: "iPhone",
          createdAt: NOW - 86_400_000,
          lastSeenAt: NOW - 3_600_000,
          connected: false,
        },
        { id: "b", name: "iPad", createdAt: NOW - 3_600_000, lastSeenAt: null, connected: false },
        {
          id: "c",
          name: "Work phone",
          createdAt: NOW - 172_800_000,
          lastSeenAt: NOW,
          connected: true,
        },
      ],
    },
  },
};

export const PairingAlongsidePairedPhone: StoryObj<RemoteHostPanelProps> = {
  args: {
    state: {
      ...READY,
      listening: true,
      pairing: { link: SAMPLE_LINK, expiresAt: NOW + 5 * 60 * 1000 },
      devices: [
        {
          id: "a",
          name: "iPhone",
          createdAt: NOW - 86_400_000,
          lastSeenAt: NOW - 3_600_000,
          connected: false,
        },
      ],
    },
  },
};

export const ListenerError: StoryObj<RemoteHostPanelProps> = {
  args: {
    state: {
      ...READY,
      error: "Copilot could not start the Remote listener. Check the logs and try again.",
    },
  },
};

const ONE_PHONE: RemoteHostViewState["devices"] = [
  {
    id: "a",
    name: "iPhone",
    createdAt: NOW - 86_400_000,
    lastSeenAt: NOW - 3_600_000,
    connected: false,
  },
];

export const KeepAwakeAlways: StoryObj<RemoteHostPanelProps> = {
  args: { keepAwakeMode: "always", state: { ...READY, listening: true, devices: ONE_PHONE } },
};

export const KeepAwakeNever: StoryObj<RemoteHostPanelProps> = {
  args: { keepAwakeMode: "never", state: { ...READY, listening: true, devices: ONE_PHONE } },
};

export const PairedPhoneWithoutPowerControl: StoryObj<RemoteHostPanelProps> = {
  args: { state: { ...READY, listening: true, devices: ONE_PHONE } },
};
