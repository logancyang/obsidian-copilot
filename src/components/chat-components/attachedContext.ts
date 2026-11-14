import { formatNoteMention } from "@/components/chat-components/pills/NotePillNode";
import { formatWebTabPillTextContent } from "@/components/chat-components/pills/WebTabPillNode";
import type { MessageContext } from "@/types/message";

// A message's text already shows what it mentions, so its badges list only the context that was attached.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/932
export function attachedContext(context: MessageContext, messageText: string): MessageContext {
  return {
    ...context,
    notes: context.notes.filter(
      (note) => !messageText.includes(formatNoteMention(note.path, note.basename))
    ),
    urls: context.urls.filter((url) => !messageText.includes(url)),
    folders: context.folders?.filter((folder) => !messageText.includes(`{${folder}}`)),
    webTabs: context.webTabs?.filter(
      (tab) => !messageText.includes(formatWebTabPillTextContent(tab.url, tab.title))
    ),
  };
}
