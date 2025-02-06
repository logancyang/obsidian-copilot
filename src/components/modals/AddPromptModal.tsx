import { App, Modal, Notice } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { err2String } from "@/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-col gap-4 p-4">
      <div className="text-xl font-bold text-normal mb-2">User Custom Prompt</div>

      <div className="flex flex-col">
        <div className="flex items-center gap-1">
          <div className="text-base font-medium text-normal">Title</div>
          <span className="text-error">*</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-sm text-muted">The title of the prompt, must be unique.</div>
          <div className="text-xs text-warning">
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
          className={`w-full mt-1`}
          required
        />
        {showTitleError && <div className="text-error text-xs mt-1">Title is required</div>}
        {hasInvalidChars && (
          <div className="text-error text-xs mt-1">Title contains invalid characters</div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <div className="text-base font-medium text-normal">Prompt</div>
            <span className="text-error">*</span>
          </div>
          <div className="text-sm text-muted -mt-1">Use the following syntax in your prompt:</div>
        </div>
        <div className="text-sm flex flex-col gap-1 bg-secondary/30 rounded-md p-2">
          <strong>- {"{}"} represents the selected text (not required). </strong>
          <strong>- {`{[[Note Title]]}`} represents a note. </strong>
          <strong>- {`{activeNote}`} represents the active note. </strong>
          <strong>- {`{FolderPath}`} represents a folder of notes. </strong>
          <strong>
            - {`{#tag1, #tag2}`} represents ALL notes with ANY of the specified tags in their
            property (an OR operation).{" "}
          </strong>
          <div className="mt-1">
            <span className="text-muted">
              Tip: turn on debug mode to show the processed prompt in the chat window.
            </span>
          </div>
        </div>

        <Textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (!touched.prompt) setTouched((prev) => ({ ...prev, prompt: true }));
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, prompt: true }))}
          className={`!min-h-[8rem] mt-1`}
          required
        />
        {showPromptError && <div className="text-error text-xs mt-1">Prompt is required</div>}

        <div className="flex flex-col text-xs text-muted gap-2 mt-2">
          <div>
            Save the prompt to the local prompt library. You can then use it with the Copilot
            command: <strong>Apply custom prompt to selection.</strong>
          </div>
          <div>
            Check out the{" "}
            <a
              href="https://github.com/f/awesome-chatgpt-prompts"
              target="_blank"
              className="text-accent hover:text-accent-hover"
              rel="noreferrer"
            >
              awesome chatGPT prompts
            </a>{" "}
            for inspiration.
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
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
