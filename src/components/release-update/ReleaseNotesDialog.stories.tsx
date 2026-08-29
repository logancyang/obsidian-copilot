import type { Meta, StoryObj } from "@/lib/story";
import { FULL_BLEED_MODAL_CLASS } from "@/components/modals/ReactModal";
import {
  ReleaseNotesDialogContent,
  type ReleaseNotesDialogContentProps,
} from "./ReleaseNotesDialog";

const RELEASE_BODY = `# v4.0.4 - A chime when your agent is ready

![Notification and sound settings in Copilot, with Marimba selected](https://github.com/user-attachments/assets/a6d2084e-84cf-4f19-aeea-8fd08decc9e3)

Copilot can now play a short chime when an agent finishes a long-running task, so you can work elsewhere without checking the chat for progress. When you hear it, return to review the result, handle an error, or approve the next tool call. Copilot stays quiet while you are already in that chat, and you can choose from four sounds or turn notifications off in **Settings → Copilot → Basic → Agents**. (https://github.com/logancyang/obsidian-copilot/pull/2988, https://github.com/logancyang/obsidian-copilot/pull/2997, https://github.com/logancyang/obsidian-copilot/pull/3003)

## ✨ Enhancements

- **Know what to do next in multi-question prompts.** The **Ask Me Questions** card now guides you through each question with a **Next** button, then switches to **Submit** on the final question. (https://github.com/logancyang/obsidian-copilot/pull/2981)
- **See more chats, projects, and Relevant Notes from Agent Home.** Recent Chats and Projects now show up to ten items, Relevant Notes has more room, and **View all** stays pinned to the bottom only when a list overflows. (https://github.com/logancyang/obsidian-copilot/pull/3005)

## 🛠️ Bug Fixes

- **Custom Commands work again in Quick Chat.** Sending one now expands it to the full saved prompt in your chat history, including any extra instructions you add. (https://github.com/logancyang/obsidian-copilot/issues/2960, https://github.com/logancyang/obsidian-copilot/pull/2990)

## ⚠️ Compatibility Notes

- **Agent paths may need to be entered again.** If you migrated from 4.0.0, re-enter them because of the vault storage migration. (https://github.com/logancyang/obsidian-copilot/pull/3002)

## 📦 Install

Update Copilot from **Obsidian → Community Plugins**. On BRAT? 4.0.4 is mirrored to the preview repo, so BRAT picks it up too.

Report issues via **Copilot Settings → Advanced → Report an Issue**.
`;

const meta = {
  title: "Release/Release Notes Dialog",
  component: ReleaseNotesDialogContent,
  args: {
    onClose: () => undefined,
    state: { status: "loading" },
  },
  parameters: {
    gallery: {
      host: "modal",
      layout: "fullscreen",
      modalClass: FULL_BLEED_MODAL_CLASS,
    },
  },
} satisfies Meta<ReleaseNotesDialogContentProps>;
export default meta;

export const Loading: StoryObj<ReleaseNotesDialogContentProps> = {};

export const ReadyWithImage: StoryObj<ReleaseNotesDialogContentProps> = {
  args: {
    state: {
      status: "ready",
      release: {
        version: "4.0.4",
        body: RELEASE_BODY,
        htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/tag/4.0.4",
      },
    },
  },
};

export const LoadFailed: StoryObj<ReleaseNotesDialogContentProps> = {
  args: { state: { status: "error" } },
};
