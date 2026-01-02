import { ProjectExtraction, ProjectCreationState } from "@/types/projects-plus";
import { ProjectManager } from "@/core/projects-plus/ProjectManager";
import {
  createInitialState,
  createMessage,
  parseProjectExtraction,
  getEffectiveExtraction,
  checkIsReady,
} from "@/core/projects-plus/ProjectCreationState";
import {
  PROJECT_EXTRACTION_SYSTEM_PROMPT,
  getInitialGreeting,
  buildFormEditContext,
} from "@/prompts/project-extraction";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { logError, logWarn } from "@/logger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, Search } from "lucide-react";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ProjectCreationForm from "./ProjectCreationForm";
import ProjectCreationChat from "./ProjectCreationChat";

interface ProjectCreationProps {
  /** Callback when user cancels project creation */
  onCancel: () => void;
  /** Callback when project is ready and user wants to proceed */
  onComplete: (extraction: ProjectExtraction) => void;
  /** ProjectManager instance for creating projects */
  projectManager: ProjectManager;
}

/**
 * Custom hook for managing project creation chat state and streaming
 */
function useProjectCreationChat() {
  const [state, setState] = useState<ProjectCreationState>(createInitialState());
  const [currentStreamingContent, setCurrentStreamingContent] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Safe state setter to prevent updates after unmount
  const safeSetState = useCallback(
    (updater: (prev: ProjectCreationState) => ProjectCreationState) => {
      if (isMountedRef.current) {
        setState(updater);
      }
    },
    []
  );

  // Initialize with AI greeting on mount
  useEffect(() => {
    const greeting = getInitialGreeting();
    const greetingMessage = createMessage("assistant", greeting);
    const extraction = parseProjectExtraction(greeting);

    safeSetState((prev) => ({
      ...prev,
      messages: [greetingMessage],
      extraction,
    }));
  }, [safeSetState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  /**
   * Send a message and stream the AI response
   */
  const sendMessage = useCallback(
    async (userContent: string, formEditContext?: string) => {
      // Add user message to state
      const userMessage = createMessage("user", userContent);
      safeSetState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isStreaming: true,
        error: null,
      }));

      // Build LLM messages
      const currentMessages = [...state.messages, userMessage];
      const llmMessages = [
        new SystemMessage(PROJECT_EXTRACTION_SYSTEM_PROMPT),
        ...currentMessages.map((m) =>
          m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
        ),
      ];

      // Inject form edit context if present
      if (formEditContext) {
        llmMessages.push(new SystemMessage(formEditContext));
      }

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        // Get chat model
        const chatModel = ChatModelManager.getInstance().getChatModel();

        // Stream the response
        let fullContent = "";
        const stream = await chatModel.stream(llmMessages, {
          signal: abortControllerRef.current.signal,
        });

        for await (const chunk of stream) {
          if (abortControllerRef.current?.signal.aborted) break;

          // Extract text content from chunk
          const chunkText = typeof chunk.content === "string" ? chunk.content : "";
          fullContent += chunkText;

          // Update streaming display (extraction block stripped in chat component)
          setCurrentStreamingContent(fullContent);
        }

        // Stream complete - parse extraction and add message
        const extraction = parseProjectExtraction(fullContent);
        if (!extraction) {
          logWarn("[ProjectCreation] Failed to parse extraction from response");
        }

        const assistantMessage = createMessage("assistant", fullContent);

        safeSetState((prev) => {
          const newState = {
            ...prev,
            messages: [...prev.messages, assistantMessage],
            extraction: extraction || prev.extraction, // Keep previous if parse fails
            isStreaming: false,
          };
          return {
            ...newState,
            isReady: checkIsReady(newState),
          };
        });

        setCurrentStreamingContent("");
      } catch (error: unknown) {
        const err = error as Error;
        if (err.name === "AbortError") {
          // User cancelled - not an error
          safeSetState((prev) => ({ ...prev, isStreaming: false }));
        } else {
          logError("[ProjectCreation] Error streaming response:", error);
          safeSetState((prev) => ({
            ...prev,
            isStreaming: false,
            error: "Failed to get response. Please try again.",
          }));
        }
        setCurrentStreamingContent("");
      }
    },
    [state.messages, safeSetState]
  );

  /**
   * Abort current streaming request
   */
  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  /**
   * Set a manual edit for a field
   */
  const setManualEdit = useCallback(
    (field: "title" | "description", value: string) => {
      safeSetState((prev) => {
        const newState = {
          ...prev,
          manualEdits: { ...prev.manualEdits, [field]: value },
        };
        return {
          ...newState,
          isReady: checkIsReady(newState),
        };
      });
    },
    [safeSetState]
  );

  /**
   * Reset state to initial
   */
  const reset = useCallback(() => {
    safeSetState(() => createInitialState());
    setCurrentStreamingContent("");
  }, [safeSetState]);

  return {
    state,
    currentStreamingContent,
    sendMessage,
    abort,
    setManualEdit,
    reset,
  };
}

/**
 * ProjectCreation - Container component for hybrid AI conversation + live form project creation
 */
export default function ProjectCreation({ onCancel, onComplete }: ProjectCreationProps) {
  const { state, currentStreamingContent, sendMessage, setManualEdit } = useProjectCreationChat();

  const [pendingFormEdit, setPendingFormEdit] = useState<{
    field: "title" | "description";
    value: string;
  } | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Compute effective extraction (manual edits override AI)
  const effectiveExtraction = getEffectiveExtraction(state);

  /**
   * Handle form field edit
   */
  const handleManualEdit = useCallback(
    (field: "title" | "description", value: string) => {
      setManualEdit(field, value);
      // Queue context for next AI message
      setPendingFormEdit({ field, value });
    },
    [setManualEdit]
  );

  /**
   * Handle sending chat message
   */
  const handleSendMessage = useCallback(
    async (content: string) => {
      // Include form edit context if pending
      const formContext = pendingFormEdit
        ? buildFormEditContext(pendingFormEdit.field, pendingFormEdit.value)
        : undefined;

      await sendMessage(content, formContext);

      // Clear pending context after sending
      setPendingFormEdit(null);
    },
    [sendMessage, pendingFormEdit]
  );

  /**
   * Handle navigation away (back button)
   */
  const handleCancel = useCallback(() => {
    const hasData =
      state.messages.length > 1 || // More than just greeting
      effectiveExtraction.title.trim() !== "" ||
      effectiveExtraction.description.trim() !== "";

    if (hasData) {
      setShowDiscardConfirm(true);
    } else {
      onCancel();
    }
  }, [state.messages.length, effectiveExtraction, onCancel]);

  /**
   * Handle completion (Find Notes button)
   */
  const handleComplete = useCallback(() => {
    onComplete(effectiveExtraction);
  }, [effectiveExtraction, onComplete]);

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      {/* Header */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-p-3">
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <ChevronLeft className="tw-size-4" />
          <span className="tw-ml-1">Back</span>
        </Button>
        <span className="tw-font-medium tw-text-normal">Creating Project</span>
      </div>

      {/* Form preview */}
      <ProjectCreationForm
        extraction={effectiveExtraction}
        manualEdits={state.manualEdits}
        onManualEdit={handleManualEdit}
        isReady={state.isReady}
      />

      {/* Chat area */}
      <ProjectCreationChat
        messages={state.messages}
        isStreaming={state.isStreaming}
        currentStreamingContent={currentStreamingContent}
        onSendMessage={handleSendMessage}
        error={state.error}
      />

      {/* Action button - shows when ready */}
      {state.isReady && !state.isStreaming && (
        <div className="tw-border tw-border-solid tw-border-transparent tw-border-t-border tw-p-3">
          <Button onClick={handleComplete} className="tw-w-full">
            <Search className="tw-mr-2 tw-size-4" />
            Find Relevant Notes
          </Button>
        </div>
      )}

      {/* Discard confirmation dialog */}
      <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard project?</DialogTitle>
          </DialogHeader>
          <p className="tw-text-sm tw-text-muted">You&apos;ll lose your conversation progress.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowDiscardConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowDiscardConfirm(false);
                onCancel();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
