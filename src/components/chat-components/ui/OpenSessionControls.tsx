import { Button } from "@/components/ui/button";
import { Power } from "lucide-react";
import React, { useState } from "react";

export function OpenSessionIndicator() {
  return (
    <span
      aria-label="Session open"
      title="Session open"
      className="tw-absolute -tw-right-0.5 -tw-top-0.5 tw-size-2 tw-rounded-full tw-bg-current tw-text-success tw-ring-1 tw-ring-[var(--background-primary)]"
    />
  );
}

interface CloseSessionButtonProps {
  chatId: string;
  onCloseSession: (id: string) => Promise<void>;
}

export function CloseSessionButton({ chatId, onCloseSession }: CloseSessionButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Disabled buttons let pointer events through; keep their clicks off the chat row.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
  return (
    <span
      className="tw-flex tw-items-center tw-gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        size="sm"
        variant="ghost"
        className="tw-size-5 tw-p-0"
        aria-label="Close session"
        title="Close session"
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          setPending(true);
          setError(null);
          // A failed release must remain retryable without deleting saved history.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
          void onCloseSession(chatId)
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : "Try again.")
            )
            .finally(() => setPending(false));
        }}
      >
        <Power className="tw-size-3" />
      </Button>
      {error && (
        <span
          role="alert"
          title={error}
          className="tw-max-w-32 tw-whitespace-normal tw-break-words tw-text-xs tw-text-error"
        >
          Could not close session: {error}
        </span>
      )}
    </span>
  );
}
