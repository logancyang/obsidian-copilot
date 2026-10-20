import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import React, { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@/lib/story";
import type { OpenArtifactsAccess } from "@/openArtifacts/types";
import {
  OpenArtifactsModalContent,
  type OpenArtifactsAccessPort,
  type OpenArtifactsModalContentProps,
} from "./OpenArtifactsModal";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const PRICING_URL = createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "openartifacts_private_sharing");

const PUBLIC_ACCESS: OpenArtifactsAccess = {
  docId: DOC_ID,
  url: `https://openartifacts.site/d/${DOC_ID}`,
  linkAccess: "anyone",
  email: true,
  people: [],
  requests: [],
};

const PRIVATE_ACCESS: OpenArtifactsAccess = {
  ...PUBLIC_ACCESS,
  linkAccess: "invited",
};

// Mounts the dialog and chooses Only those invited, so a story can show the state that follows
// the click. Choosing waits for the access list to load when the dialog manages a page.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
function AfterSwitch({
  access,
  docId,
}: {
  access: OpenArtifactsAccessPort;
  docId: string | null;
}): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(
      () => container.current?.querySelectorAll<HTMLElement>('[role="radio"]')[1]?.click(),
      docId ? 100 : 0
    );
    return () => window.clearTimeout(timer);
  }, [docId]);
  return (
    <div ref={container}>
      <OpenArtifactsModalContent
        fileName="Architecture"
        docId={docId}
        access={access}
        onClose={() => undefined}
        onConfirm={async (action) => ({
          kind: "failure",
          action,
          message: "Preview interaction only.",
          accessNotice: false,
          retryable: false,
        })}
      />
    </div>
  );
}

// A fake port whose answers are held in memory, so the stories need no server.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
function fakeAccessPort(initial: OpenArtifactsAccess): OpenArtifactsAccessPort {
  let current = initial;
  return {
    load: async () => current,
    setLinkAccess: async (_docId, linkAccess) => (current = { ...current, linkAccess }),
    open: async () => current.url,
  };
}

const meta = {
  title: "Modals/OpenArtifacts",
  component: OpenArtifactsModalContent,
  args: {
    fileName: "Architecture",
    docId: null,
    onClose: () => undefined,
    onConfirm: async (action) => ({
      kind: "failure",
      action,
      message: "Preview interaction only.",
      accessNotice: false,
      retryable: false,
    }),
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<OpenArtifactsModalContentProps>;
export default meta;

export const Publish: StoryObj<OpenArtifactsModalContentProps> = {};

export const Manage: StoryObj<OpenArtifactsModalContentProps> = {
  args: { docId: DOC_ID, access: fakeAccessPort(PUBLIC_ACCESS) },
};

// The first-publish confirmation with Only those invited chosen.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const PublishPrivate: StoryObj<OpenArtifactsModalContentProps> = {
  render: () => <AfterSwitch access={fakeAccessPort(PRIVATE_ACCESS)} docId={null} />,
};

// A public page, so switching to Only those invited shows the copy notice.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const ManageAfterSwitchToPrivate: StoryObj<OpenArtifactsModalContentProps> = {
  render: () => <AfterSwitch access={fakeAccessPort(PUBLIC_ACCESS)} docId={DOC_ID} />,
};

// A server without private documents answers the access routes with 404.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const UnsupportedServer: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    docId: DOC_ID,
    access: {
      ...fakeAccessPort(PUBLIC_ACCESS),
      load: async () => {
        // The gallery may not import the client, so the story raises the same code by hand.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
        throw Object.assign(
          new Error("Not found, or this server does not support private documents."),
          { code: "private_unavailable" }
        );
      },
    },
  },
};

// A server that gives this plan publishing but not private sharing refuses Only those invited: nothing is created.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const PrivateSharingNeedsPaidPlan: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    onConfirm: async (action) => ({
      kind: "failure",
      action,
      message: "Your Copilot plan does not include private sharing.",
      accessNotice: false,
      retryable: false,
      upgradeUrl: PRICING_URL,
    }),
  },
};

// The screen after a first publish: the receipt, then the access panel.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const PublishedWithAccessPanel: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    access: fakeAccessPort(PRIVATE_ACCESS),
    initialResult: {
      kind: "success",
      action: "publish",
      receipt: { docId: DOC_ID, url: PRIVATE_ACCESS.url, version: 1, linkAccess: "invited" },
    },
  },
};

// The first publish for a Copilot license that is not linked to an OpenArtifacts account: the server's one-time offer.
// https://github.com/Brevilabs/OpenArtifacts/issues/94
export const PublishedWithAccountLinkOffer: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    access: fakeAccessPort(PUBLIC_ACCESS),
    initialResult: {
      kind: "success",
      action: "publish",
      receipt: {
        docId: DOC_ID,
        url: PUBLIC_ACCESS.url,
        version: 1,
        linkAccess: "anyone",
        guidance: {
          message:
            "Publish from other agents too? Link your Copilot for Obsidian account to OpenArtifacts to get an email when people you share with comment or ask for access.",
          url: "https://example.com/link-account",
        },
      },
    },
  },
};

export const Removed: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    docId: "9f2k4mvq7t0xbz3n",
    initialResult: { kind: "success", action: "delete" },
  },
};
