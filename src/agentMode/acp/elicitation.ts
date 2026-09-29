import type {
  CreateElicitationRequest,
  ElicitationContentValue,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
  StringPropertySchema,
} from "@agentclientprotocol/sdk";
import type {
  AgentQuestion,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  SessionId,
} from "@/agentMode/session/types";

type ElicitationContent = Record<string, ElicitationContentValue>;

const CODEX_OTHER_OPTION = "None of the above";

export interface ElicitationQuestionForm {
  prompt: AskUserQuestionPrompt;
  toContent: (answers: AgentQuestionAnswers) => ElicitationContent;
}

function codexMeta(field: ElicitationPropertySchema): Record<string, unknown> | undefined {
  const codex = (field._meta as { codex?: unknown } | null | undefined)?.codex;
  return typeof codex === "object" && codex !== null
    ? (codex as Record<string, unknown>)
    : undefined;
}

// Any form other than Codex's `request_user_input` shape is declined: the card cannot collect
// it faithfully. https://github.com/Brevilabs/obsidian-copilot-private/issues/551
export function formToQuestionPrompt(
  request: CreateElicitationRequest,
  requestId: string
): ElicitationQuestionForm | null {
  if (request.mode !== "form" || !("sessionId" in request) || !("requestedSchema" in request))
    return null;
  const properties = Object.entries(
    (request.requestedSchema as ElicitationSchema).properties ?? {}
  );
  const noteIds = new Map<string, string>();
  for (const [id, field] of properties) {
    const meta = codexMeta(field);
    if (meta?.role === "user_note" && typeof meta.questionId === "string") {
      noteIds.set(meta.questionId, id);
    }
  }

  const questions: AgentQuestion[] = [];
  const choicesByKey = new Map<string, EnumOption[]>();
  for (const [id, field] of properties) {
    const meta = codexMeta(field);
    if (meta?.role === "user_note") continue;
    if (!meta || field.type !== "string") return null;
    const { title, description, oneOf: choices } = field as StringPropertySchema;
    if (!choices?.length) return null;
    const allowOther = noteIds.has(id);
    choicesByKey.set(id, choices);
    questions.push({
      question: title || id,
      ...(description ? { header: description } : {}),
      answerKey: id,
      options: choices
        .filter((choice) => !allowOther || choice.const !== CODEX_OTHER_OPTION)
        .map((choice) => ({
          label: choice.title,
          ...(choice.description ? { description: choice.description } : {}),
        })),
      allowOther,
    });
  }
  if (questions.length === 0) return null;

  return {
    prompt: { sessionId: request.sessionId as SessionId, requestId, questions },
    toContent: (answers) => {
      const content: ElicitationContent = {};
      for (const [id, choices] of choicesByKey) {
        const answer = answers[id];
        if (answer === undefined) continue;
        const choice = choices.find((option) => option.title === answer);
        const noteId = noteIds.get(id);
        if (choice) {
          content[id] = choice.const;
        } else if (noteId) {
          content[id] = CODEX_OTHER_OPTION;
          content[noteId] = answer;
        }
      }
      return content;
    },
  };
}
