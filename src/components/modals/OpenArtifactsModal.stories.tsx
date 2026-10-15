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
  people: [
    { email: "alice@acme.com", role: "comment", addedAt: 1785000000000 },
    { email: "carol@example.org", role: "comment", addedAt: 1785000050000 },
  ],
  requests: [{ email: "bob@other.com", requestedAt: 1785000100000 }],
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
    addPerson: async (_docId, email) =>
      (current = {
        ...current,
        people: [...current.people, { email, role: "comment", addedAt: Date.now() }],
        requests: current.requests.filter((request) => request.email !== email),
      }),
    removePerson: async (_docId, email) =>
      (current = { ...current, people: current.people.filter((person) => person.email !== email) }),
    declineRequest: async (_docId, email) =>
      (current = {
        ...current,
        requests: current.requests.filter((request) => request.email !== email),
      }),
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

// Two invitees and one pending request, with Approve and Decline.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const ManageWithInviteesAndRequest: StoryObj<OpenArtifactsModalContentProps> = {
  args: { docId: DOC_ID, access: fakeAccessPort(PRIVATE_ACCESS) },
};

// Invitees when the server sends no email: the owner shares the link.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const ManageWithoutInviteEmail: StoryObj<OpenArtifactsModalContentProps> = {
  args: { docId: DOC_ID, access: fakeAccessPort({ ...PRIVATE_ACCESS, email: false }) },
};

// A public page, so switching to Only those invited shows the copy notice.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const ManageAfterSwitchToPrivate: StoryObj<OpenArtifactsModalContentProps> = {
  render: () => <AfterSwitch access={fakeAccessPort(PUBLIC_ACCESS)} docId={DOC_ID} />,
};

// An old or self-hosted server answers the access routes with 404.
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

// A free or lapsed plan choosing Only those invited: nothing is created.
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

export const Removed: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    docId: "9f2k4mvq7t0xbz3n",
    initialResult: { kind: "success", action: "delete" },
  },
};
