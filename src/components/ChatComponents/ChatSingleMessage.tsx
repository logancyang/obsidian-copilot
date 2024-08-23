import { BotIcon, CheckIcon, CopyClipboardIcon, UserIcon } from "@/components/Icons";
import MemoizedReactMarkdown from "@/components/Markdown/MemoizedReactMarkdown";
import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import React, { useState } from "react";

interface ChatSingleMessageProps {
  message: ChatMessage;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({ message }) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(message.message).then(() => {
      setIsCopied(true);

      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    });
  };

  // const markdown = `
  // The Maxwell equations are:

  // 1. Gauss's Law:
  //    \\(\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\epsilon_0}\\)

  // 2. Gauss's Law for Magnetism:
  //    \\(\\nabla \\cdot \\mathbf{B} = 0\\)

  // 3. Faraday's Law of Induction:
  //    \\(\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}\\)

  // 4. Ampère-Maxwell Law:
  //    \\(\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\epsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}\\)
  // `;

  return (
    <div className="message-container">
      <div className={`message ${message.sender === USER_SENDER ? "user-message" : "bot-message"}`}>
        <div className="message-icon">
          {message.sender === USER_SENDER ? <UserIcon /> : <BotIcon />}
        </div>
        <div className="message-content">
          {message.sender === USER_SENDER ? (
            <span>{message.message}</span>
          ) : (
            <MemoizedReactMarkdown>{message.message}</MemoizedReactMarkdown>
          )}
        </div>
      </div>
      <button onClick={copyToClipboard} className="copy-message-button">
        {isCopied ? <CheckIcon /> : <CopyClipboardIcon />}
      </button>
    </div>
  );
};

export default ChatSingleMessage;
