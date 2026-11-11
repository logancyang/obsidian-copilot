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

export function formatChatsDeleteNotice(count: number): string {
  return `${count} ${count === 1 ? "chat" : "chats"} deleted from Copilot.`;
}
