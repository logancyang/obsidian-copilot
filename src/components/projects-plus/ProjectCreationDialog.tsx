import {
  CreateProjectInput,
  NoteSuggestion,
  Project,
  ProjectCreationState,
  ProjectExtraction,
} from "@/types/projects-plus";
import {
  createInitialState,
  createMessage,
  parseProjectExtraction,
  getEffectiveExtraction,
  checkIsReady,
} from "@/core/projects-plus/ProjectCreationState";
import { NoteAssignmentService } from "@/core/projects-plus/NoteAssignmentService";
import { useNoteAssignment } from "@/hooks/useNoteAssignment";
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
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectForm, ProjectFormData } from "./ProjectForm";
import { ProjectChat } from "./ProjectChat";
import NoteSuggestions from "./NoteSuggestions";
import { ArrowLeft, Search } from "lucide-react";

type DialogStep = "create" | "notes";

interface ProjectCreationDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback when project is created - returns the created project */
  onProjectCreated: (input: CreateProjectInput) => Promise<Project>;
  /** Callback to add notes to a project */
  onAddNotes: (projectId: string, suggestions: NoteSuggestion[]) => Promise<void>;
  /** Service for finding relevant notes */
  noteAssignmentService: NoteAssignmentService;
  /** Callback to open a note in Obsidian */
  onOpenNote?: (path: string) => void;
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
          logWarn("[ProjectCreationDialog] Failed to parse extraction from response");
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
          logError("[ProjectCreationDialog] Error streaming response:", error);
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
   * Set a manual edit for a field
   */
  const setManualEdit = useCallback(
    <K extends keyof ProjectExtraction>(field: K, value: ProjectExtraction[K]) => {
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
    // Re-initialize with greeting
    const greeting = getInitialGreeting();
    const greetingMessage = createMessage("assistant", greeting);
    const extraction = parseProjectExtraction(greeting);
    safeSetState((prev) => ({
      ...prev,
      messages: [greetingMessage],
      extraction,
    }));
  }, [safeSetState]);

  return {
    state,
    currentStreamingContent,
    sendMessage,
    setManualEdit,
    reset,
  };
}

/**
 * ProjectCreationDialog - Modal dialog for creating a new project
 *
 * Two-step flow:
 * 1. Create: AI-assisted project definition with form
 * 2. Notes: Find and add relevant notes to the project
 */
export function ProjectCreationDialog({
  open,
  onOpenChange,
  onProjectCreated,
  onAddNotes,
  noteAssignmentService,
  onOpenNote,
}: ProjectCreationDialogProps) {
  const { state, currentStreamingContent, sendMessage, setManualEdit, reset } =
    useProjectCreationChat();
  const [pendingFormEdit, setPendingFormEdit] = useState<{
    field: keyof ProjectExtraction;
    value: unknown;
  } | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [deadline, setDeadline] = useState<Date | undefined>(undefined);
  const [step, setStep] = useState<DialogStep>("create");
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Reset step when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("create");
      setCreatedProject(null);
    }
  }, [open]);

  // Compute effective extraction (manual edits override AI)
  const effectiveExtraction = getEffectiveExtraction(state);

  // Convert extraction to form data format
  const formData: ProjectFormData = {
    title: effectiveExtraction.title,
    description: effectiveExtraction.description,
    successCriteria: effectiveExtraction.successCriteria,
    deadline,
  };

  // Build manual edits for form (convert types)
  const formManualEdits: Partial<ProjectFormData> = {
    ...(state.manualEdits.title !== undefined && { title: state.manualEdits.title }),
    ...(state.manualEdits.description !== undefined && {
      description: state.manualEdits.description,
    }),
    ...(state.manualEdits.successCriteria !== undefined && {
      successCriteria: state.manualEdits.successCriteria,
    }),
    ...(deadline !== undefined && { deadline }),
  };

  /**
   * Handle form field edit
   */
  const handleManualEdit = useCallback(
    <K extends keyof ProjectFormData>(field: K, value: ProjectFormData[K]) => {
      if (field === "deadline") {
        setDeadline(value as Date | undefined);
      } else {
        setManualEdit(
          field as keyof ProjectExtraction,
          value as ProjectExtraction[keyof ProjectExtraction]
        );
        // Queue context for next AI message (only for title/description)
        if (field === "title" || field === "description") {
          setPendingFormEdit({ field, value });
        }
      }
    },
    [setManualEdit]
  );

  /**
   * Handle sending chat message
   */
  const handleSendMessage = useCallback(
    async (content: string) => {
      // Include form edit context if pending
      const formContext =
        pendingFormEdit &&
        (pendingFormEdit.field === "title" || pendingFormEdit.field === "description")
          ? buildFormEditContext(pendingFormEdit.field, String(pendingFormEdit.value))
          : undefined;

      await sendMessage(content, formContext);

      // Clear pending context after sending
      setPendingFormEdit(null);
    },
    [sendMessage, pendingFormEdit]
  );

  /**
   * Handle dialog close request
   */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        // Check if there's data to discard
        const hasData =
          state.messages.length > 1 ||
          effectiveExtraction.title.trim() !== "" ||
          effectiveExtraction.description.trim() !== "";

        if (hasData && step === "create") {
          setShowDiscardConfirm(true);
        } else {
          onOpenChange(false);
        }
      } else {
        onOpenChange(true);
      }
    },
    [state.messages.length, effectiveExtraction, onOpenChange, step]
  );

  /**
   * Handle confirmed discard
   */
  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
    reset();
    setDeadline(undefined);
    setStep("create");
    setCreatedProject(null);
    onOpenChange(false);
  }, [reset, onOpenChange]);

  /**
   * Handle create project and move to notes step
   */
  const handleCreateAndFindNotes = useCallback(async () => {
    const input: CreateProjectInput = {
      title: effectiveExtraction.title,
      description: effectiveExtraction.description,
      successCriteria: effectiveExtraction.successCriteria,
      deadline: deadline?.getTime(),
    };

    setIsCreating(true);
    try {
      const project = await onProjectCreated(input);
      setCreatedProject(project);
      setStep("notes");
    } catch (error) {
      logError("[ProjectCreationDialog] Error creating project:", error);
    } finally {
      setIsCreating(false);
    }
  }, [effectiveExtraction, deadline, onProjectCreated]);

  /**
   * Handle skipping notes and finishing
   */
  const handleSkipNotes = useCallback(() => {
    reset();
    setDeadline(undefined);
    setStep("create");
    setCreatedProject(null);
    onOpenChange(false);
  }, [reset, onOpenChange]);

  /**
   * Handle going back to create step
   */
  const handleBackToCreate = useCallback(() => {
    setStep("create");
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="tw-flex tw-h-[600px] tw-max-w-[800px] tw-flex-col tw-gap-0 tw-p-0">
          <DialogHeader className="tw-shrink-0 tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-px-6 tw-py-4">
            <DialogTitle>
              {step === "create" ? "Create New Project" : "Find Relevant Notes"}
            </DialogTitle>
          </DialogHeader>

          {step === "create" ? (
            <>
              {/* Main content: left-right split */}
              <div className="tw-flex tw-flex-1 tw-overflow-hidden">
                {/* Left Panel: Form (40%) */}
                <div className="tw-w-2/5 tw-shrink-0 tw-overflow-y-auto tw-border tw-border-solid tw-border-transparent tw-border-r-border tw-p-4">
                  <ProjectForm
                    formData={formData}
                    manualEdits={formManualEdits}
                    onManualEdit={handleManualEdit}
                    isReady={state.isReady}
                  />
                </div>

                {/* Right Panel: Chat (60%) */}
                <div className="tw-flex tw-w-3/5 tw-flex-col tw-overflow-hidden">
                  <ProjectChat
                    messages={state.messages}
                    isStreaming={state.isStreaming}
                    currentStreamingContent={currentStreamingContent}
                    onSendMessage={handleSendMessage}
                    error={state.error}
                  />
                </div>
              </div>

              {/* Footer */}
              <DialogFooter className="tw-shrink-0 tw-border tw-border-solid tw-border-transparent tw-border-t-border tw-px-6 tw-py-4">
                <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateAndFindNotes}
                  disabled={!state.isReady || state.isStreaming || isCreating}
                >
                  <Search className="tw-mr-2 tw-size-4" />
                  {isCreating ? "Creating..." : "Create & Find Notes"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <NoteSuggestionsStep
              project={createdProject!}
              noteAssignmentService={noteAssignmentService}
              onAddNotes={onAddNotes}
              onOpenNote={onOpenNote}
              onBack={handleBackToCreate}
              onDone={handleSkipNotes}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Discard confirmation dialog */}
      <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard project?</DialogTitle>
          </DialogHeader>
          <p className="tw-text-sm tw-text-muted">You&apos;ll lose your conversation progress.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowDiscardConfirm(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={handleConfirmDiscard}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * NoteSuggestionsStep - Second step of the dialog for finding notes
 */
interface NoteSuggestionsStepProps {
  project: Project;
  noteAssignmentService: NoteAssignmentService;
  onAddNotes: (projectId: string, suggestions: NoteSuggestion[]) => Promise<void>;
  onOpenNote?: (path: string) => void;
  onBack: () => void;
  onDone: () => void;
}

function NoteSuggestionsStep({
  project,
  noteAssignmentService,
  onAddNotes,
  onOpenNote,
  onBack,
  onDone,
}: NoteSuggestionsStepProps) {
  const {
    isSearching,
    result,
    selected,
    toggleSelection,
    selectAll,
    clearSelection,
    dismiss,
    search,
    visibleSuggestions,
  } = useNoteAssignment(project, noteAssignmentService);
  const [isAdding, setIsAdding] = useState(false);
  const hasSearched = useRef(false);

  // Auto-search on mount
  useEffect(() => {
    if (!hasSearched.current) {
      hasSearched.current = true;
      search();
    }
  }, [search]);

  const handleAccept = async (paths: string[]) => {
    const selectedSuggestions = visibleSuggestions.filter((s) => paths.includes(s.path));
    if (selectedSuggestions.length === 0) return;

    setIsAdding(true);
    try {
      await onAddNotes(project.id, selectedSuggestions);
      onDone();
    } catch (error) {
      logError("[NoteSuggestionsStep] Error adding notes:", error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      <div className="tw-flex tw-flex-1 tw-flex-col tw-overflow-hidden tw-p-4">
        {/* Project info */}
        <div className="tw-mb-4 tw-rounded-md tw-bg-secondary tw-p-3">
          <h3 className="tw-font-medium tw-text-normal">{project.title}</h3>
          <p className="tw-mt-1 tw-line-clamp-2 tw-text-sm tw-text-muted">{project.description}</p>
        </div>

        {/* Suggestions */}
        <div className="tw-flex-1 tw-overflow-y-auto">
          <NoteSuggestions
            suggestions={visibleSuggestions}
            selected={selected}
            onToggleSelection={toggleSelection}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onDismiss={dismiss}
            onAccept={handleAccept}
            onOpenNote={onOpenNote}
            isLoading={isSearching}
            generatedQuery={result?.generatedQuery}
            totalSearched={result?.totalSearched}
            error={result?.error}
          />
        </div>
      </div>

      {/* Footer */}
      <DialogFooter className="tw-shrink-0 tw-border tw-border-solid tw-border-transparent tw-border-t-border tw-px-6 tw-py-4">
        <Button variant="ghost" onClick={onBack} disabled={isAdding}>
          <ArrowLeft className="tw-mr-2 tw-size-4" />
          Back
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={isAdding}>
          {selected.size > 0 ? "Skip" : "Done"}
        </Button>
      </DialogFooter>
    </>
  );
}
