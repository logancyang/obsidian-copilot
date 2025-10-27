import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { App, Modal, Platform } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { UserSystemPrompt } from "@/system-prompts/type";
import { validatePromptName } from "@/system-prompts/systemPromptUtils";

// Built-in templates
const BUILT_IN_TEMPLATES = [
  {
    id: "default",
    name: "Default Assistant",
    content: "You are a helpful AI assistant. Answer questions clearly and concisely.",
    isBuiltIn: true,
    exampleUrl: "https://example.com/default-assistant",
  },
  {
    id: "default1",
    name: "Default Assistant",
    content: "You are a helpful AI assistant. Answer questions clearly and concisely.",
    isBuiltIn: true,
    exampleUrl: "https://example.com/default-assistant",
  },
  {
    id: "default2",
    name: "Default Assistant",
    content: "You are a helpful AI assistant. Answer questions clearly and concisely.",
    isBuiltIn: true,
    exampleUrl: "https://example.com/default-assistant",
  },
  {
    id: "professional",
    name: "Professional Tone",
    content:
      "You are a professional AI assistant. Maintain a formal, business-appropriate tone in all responses. Provide detailed, well-structured answers.",
    isBuiltIn: true,
    exampleUrl: "https://example.com/professional-tone",
  },
  {
    id: "creative",
    name: "Creative Writer",
    content:
      "You are a creative AI assistant with a flair for storytelling and imaginative thinking. Use vivid language and engaging narratives in your responses.",
    isBuiltIn: true,
    exampleUrl: "https://example.com/creative-writer",
  },
  {
    id: "technical",
    name: "Technical Expert",
    content:
      "You are a technical AI assistant specializing in programming and technology. Provide detailed technical explanations with code examples when relevant.",
    isBuiltIn: true,
    exampleUrl: "https://example.com/technical-expert",
  },
];

interface Template {
  id: string;
  name: string;
  content: string;
  isBuiltIn?: boolean;
  exampleUrl?: string;
}

type FormErrors = {
  title?: string;
  content?: string;
};

interface SystemPromptEditModalContentProps {
  prompts: UserSystemPrompt[];
  prompt: UserSystemPrompt;
  initialPrompt: UserSystemPrompt;
  onConfirm: (prompt: UserSystemPrompt) => void;
  onCancel: () => void;
  contentEl: HTMLElement;
}

function SystemPromptEditModalContent({
  prompts,
  prompt: initialPrompt,
  onConfirm,
  onCancel,
  contentEl,
}: SystemPromptEditModalContentProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [errors, setErrors] = useState<FormErrors>({});

  const handleUpdate = (field: keyof UserSystemPrompt, value: any) => {
    setPrompt((prev) => ({
      ...prev,
      [field]: value,
    }));
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const handleSelectTemplate = (template: Template) => {
    handleUpdate("content", template.content);
  };

  const handleSubmit = () => {
    const newErrors: FormErrors = {};

    const nameError = validatePromptName(prompt.title, prompts, initialPrompt.title);
    if (nameError) {
      newErrors.title = nameError;
    }

    if (!prompt.content.trim()) {
      newErrors.content = "Content is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onConfirm(prompt);
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="title">Name</Label>
        <Input
          id="title"
          placeholder="Enter prompt name. e.g: My Custom Assistant"
          value={prompt.title}
          onChange={(e) => handleUpdate("title", e.target.value)}
        />
        {errors.title && <div className="tw-text-sm tw-text-error">{errors.title}</div>}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="content">Content</Label>
        <div className="tw-relative">
          <Textarea
            id="content"
            placeholder="Enter your system prompt here..."
            value={prompt.content}
            onChange={(e) => handleUpdate("content", e.target.value)}
            rows={12}
            className="tw-min-h-[200px] tw-w-full tw-pr-8"
          />
          <TooltipProvider>
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="tw-absolute tw-right-2 tw-top-2">
                      <Sparkles className="tw-size-4" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Choose from templates</p>
                </TooltipContent>
              </Tooltip>
              <PopoverContent className="tw-w-80 tw-p-3" align="end" container={contentEl}>
                <div className="tw-space-y-2">
                  <div className="tw-mb-2 tw-text-sm tw-font-medium">Choose a Template</div>
                  {BUILT_IN_TEMPLATES.map((template) => (
                    <div
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="tw-flex tw-min-w-0 tw-cursor-pointer tw-items-center tw-gap-2 tw-truncate tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-2 tw-transition-colors hover:tw-bg-modifier-hover"
                    >
                      <div className="tw-flex tw-min-w-0 tw-flex-col">
                        <div className="tw-text-sm tw-font-medium">{template.name}</div>
                        <div className="tw-mt-0.5 tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-text-muted">
                          {template.content}
                        </div>
                      </div>
                      {template.exampleUrl && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="tw-size-7 tw-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(template.exampleUrl, "_blank");
                          }}
                          title="View prompt example"
                        >
                          <ExternalLink className="tw-size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </TooltipProvider>
        </div>
        {errors.content && <div className="tw-text-sm tw-text-error">{errors.content}</div>}
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={handleSubmit}>
          Save
        </Button>
      </div>
    </div>
  );
}

export class SystemPromptEditModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private prompts: UserSystemPrompt[],
    private prompt: UserSystemPrompt,
    private onUpdate: (prompt: UserSystemPrompt) => Promise<void>
  ) {
    super(app);
    const isCreating = !prompt.title;
    const title = isCreating ? "Create System Prompt" : "Edit System Prompt";
    // @ts-ignore
    this.setTitle(title);
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    if (Platform.isMobile) {
      modalEl.style.height = "80%";
    }

    this.root = createRoot(contentEl);

    const handleConfirm = (prompt: UserSystemPrompt) => {
      this.onUpdate(prompt);
      this.close();
    };

    this.root.render(
      <SystemPromptEditModalContent
        prompts={this.prompts}
        prompt={this.prompt}
        initialPrompt={this.prompt}
        onConfirm={handleConfirm}
        onCancel={() => this.close()}
        contentEl={contentEl}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
