import { App, Modal, Notice } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { err2String } from "@/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CustomPromptSyntaxInstruction } from "@/components/CustomPromptSyntaxInstruction";

interface AddPromptModalContentProps {
  initialTitle?: string;
  initialPrompt?: string;
  disabledTitle?: boolean;
  onSave: (title: string, prompt: string) => Promise<void>;
  onCancel: () => void;
}

function AddPromptModalContent({
  initialTitle = "",
  initialPrompt = "",
  disabledTitle = false,
  onSave,
  onCancel,
}: AddPromptModalContentProps) {
  const [title, setTitle] = useState(initialTitle);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [touched, setTouched] = useState({ title: false, prompt: false });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Invalid characters for filename
  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/g;
  const hasInvalidChars = title && invalidChars.test(title);

  const handleSave = async () => {
    if (hasInvalidChars) {
      new Notice("Title contains invalid characters. Please remove them before saving.");
      return;
    }

    if (title && prompt) {
      try {
        setIsSubmitting(true);
        await onSave(title, prompt);
      } catch (e) {
        new Notice(err2String(e));
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setTouched({ title: true, prompt: true });
      new Notice("Please fill in both fields: Title and Prompt.");
    }
  };

  const showTitleError = touched.title && !title;
  const showPromptError = touched.prompt && !prompt;
  const isValid = title.trim() !== "" && prompt.trim() !== "" && !hasInvalidChars;

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
      <div className="tw-mb-2 tw-text-xl tw-font-bold tw-text-normal">User Custom Prompt</div>

      <div className="tw-flex tw-flex-col">
        <div className="tw-flex tw-items-center tw-gap-1">
          <div className="tw-text-base tw-font-medium tw-text-normal">Title</div>
          <span className="tw-text-error">*</span>
        </div>
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-sm tw-text-muted">The title of the prompt, must be unique.</div>
          <div className="tw-text-xs tw-text-warning">
            Note: Title will be used as filename. Avoid using: {'< > : " / \\ | ? *'}
          </div>
        </div>
        <Input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!touched.title) setTouched((prev) => ({ ...prev, title: true }));
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
          disabled={disabledTitle}
          className="tw-mt-1 tw-w-full"
          required
        />
        {showTitleError && (
          <div className="tw-mt-1 tw-text-xs tw-text-error">Title is required</div>
        )}
        {hasInvalidChars && (
          <div className="tw-mt-1 tw-text-xs tw-text-error">Title contains invalid characters</div>
        )}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-1">
        <div className="tw-space-y-2">
          <div className="tw-flex tw-items-center tw-gap-1">
            <div className="tw-text-base tw-font-medium tw-text-normal">Prompt</div>
            <span className="tw-text-error">*</span>
          </div>
          <div className="tw--mt-1 tw-text-sm tw-text-muted">
            Use the following syntax in your prompt:
          </div>
        </div>
        <CustomPromptSyntaxInstruction />

        <Textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (!touched.prompt) setTouched((prev) => ({ ...prev, prompt: true }));
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, prompt: true }))}
          className="tw-mt-1 !tw-min-h-32"
          required
        />
        {showPromptError && (
          <div className="tw-mt-1 tw-text-xs tw-text-error">Prompt is required</div>
        )}

        <div className="tw-mt-2 tw-flex tw-flex-col tw-gap-2 tw-text-xs tw-text-muted">
          <div>
            Save the prompt to the local prompt library. You can then use it with the Copilot
            command: <strong>Apply custom prompt to selection.</strong>
          </div>
          <div>
            Check out the{" "}
            <a
              href="https://github.com/f/awesome-chatgpt-prompts"
              target="_blank"
              className="tw-text-accent hover:tw-text-accent-hover"
              rel="noreferrer"
            >
              awesome chatGPT prompts
            </a>{" "}
            for inspiration.
          </div>
        </div>
      </div>

      <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!isValid || isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

export class AddPromptModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onSave: (title: string, prompt: string) => Promise<void>,
    private initialTitle = "",
    private initialPrompt = "",
    private disabledTitle?: boolean
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleSave = async (title: string, prompt: string) => {
      await this.onSave(title, prompt);
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <AddPromptModalContent
        initialTitle={this.initialTitle}
        initialPrompt={this.initialPrompt}
        disabledTitle={this.disabledTitle}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
