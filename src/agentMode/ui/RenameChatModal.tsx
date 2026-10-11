import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { App } from "obsidian";
import React, { useState } from "react";

export interface RenameChatFormProps {
  initialTitle: string;
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}

export function RenameChatForm({
  initialTitle,
  onSave,
  onCancel,
}: RenameChatFormProps): React.ReactElement {
  const [title, setTitle] = useState(initialTitle);
  const trimmedTitle = title.trim();

  return (
    <form
      className="tw-flex tw-flex-col tw-gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // A blank title would leave the row with nothing to recognize it by: https://github.com/Brevilabs/obsidian-copilot-private/issues/693
        if (trimmedTitle) safeAsyncHandler(onSave)(trimmedTitle);
      }}
    >
      <Input
        aria-label="Chat title"
        value={title}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmedTitle}>
          Save
        </Button>
      </div>
    </form>
  );
}

export class RenameChatModal extends ReactModal {
  constructor(
    app: App,
    private readonly currentTitle: string,
    private readonly onRename: (title: string) => Promise<void>
  ) {
    super(app, "Rename chat");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <RenameChatForm
        initialTitle={this.currentTitle}
        onSave={async (title) => {
          await this.onRename(title);
          close();
        }}
        onCancel={close}
      />
    );
  }
}
