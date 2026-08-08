import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Check, Copy } from "lucide-react";
import React from "react";

interface CopyButtonProps {
  /** Final text copied verbatim — callers clean/format before passing. */
  text: string;
}

/** Copy-to-clipboard action button that swaps to a check mark for 2s after copying. */
export const CopyButton: React.FC<CopyButtonProps> = ({ text }) => {
  const { isCopied, copy } = useCopyToClipboard();
  return (
    <MessageActionButton label="Copy" icon={isCopied ? Check : Copy} onClick={() => copy(text)} />
  );
};
