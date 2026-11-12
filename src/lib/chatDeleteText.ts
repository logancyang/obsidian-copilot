interface DeleteTextDescriptor {
  displayName: string;
  agentProductName?: string;
}

function agentName(descriptor: DeleteTextDescriptor): string {
  return descriptor.agentProductName ?? descriptor.displayName;
}

export function describeChatDelete(descriptor: DeleteTextDescriptor | undefined): string {
  return descriptor
    ? `Delete this chat from Copilot? ${agentName(descriptor)} may keep its own copy of this conversation on this computer.`
    : "Delete this chat from Copilot?";
}

export function formatChatDeleteNotice(descriptor: DeleteTextDescriptor | undefined): string {
  return descriptor
    ? `Chat deleted from Copilot. ${agentName(descriptor)} may keep its own copy.`
    : "Chat deleted from Copilot.";
}

export function describeChatsDelete(
  descriptors: readonly (DeleteTextDescriptor | undefined)[]
): string {
  const question = `Delete ${descriptors.length} chats from Copilot?`;
  return descriptors.some(Boolean)
    ? `${question} Their agents may keep their own copies of these conversations on this computer.`
    : question;
}

const CHATS_RESULT_TEXT = {
  delete: { done: "deleted from Copilot", failed: "could not be deleted" },
  archive: { done: "archived", failed: "could not be archived" },
} as const;

function countChats(count: number): string {
  return `${count} ${count === 1 ? "chat" : "chats"}`;
}

export function formatChatsResultNotice(
  action: keyof typeof CHATS_RESULT_TEXT,
  done: number,
  failed: number
): string {
  const text = CHATS_RESULT_TEXT[action];
  return [
    done > 0 && `${countChats(done)} ${text.done}.`,
    failed > 0 && `${countChats(failed)} ${text.failed}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
