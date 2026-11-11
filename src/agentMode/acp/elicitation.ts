import type {
  CreateElicitationRequest,
  ElicitationContentValue,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
  MultiSelectPropertySchema,
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

// A form with a field the question card cannot collect faithfully, such as free text or a number, is
// declined. https://github.com/Brevilabs/obsidian-copilot-private/issues/551
export function formToQuestionPrompt(
  request: CreateElicitationRequest,
  requestId: string
): ElicitationQuestionForm | null {
  if (request.mode !== "form" || !("sessionId" in request) || !("requestedSchema" in request))
    return null;
  const properties = Object.entries(
    (request.requestedSchema as ElicitationSchema).properties ?? {}
  );
  if (!properties.some(([, field]) => codexMeta(field))) {
    return standardFormToQuestionPrompt(request.sessionId as SessionId, requestId, properties);
  }
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

const OTHER_FIELD_SUFFIX = "_other";
const MULTI_SELECT_SEPARATOR = ", ";

interface StandardChoiceField {
  id: string;
  choices: EnumOption[];
  multiSelect: boolean;
  noteId?: string;
}

function standardChoices(field: ElicitationPropertySchema): EnumOption[] | null {
  if (field.type === "string") return (field as StringPropertySchema).oneOf ?? null;
  if (field.type !== "array") return null;
  const items = (field as MultiSelectPropertySchema).items as { anyOf?: EnumOption[] };
  return items.anyOf ?? null;
}

function standardFormToQuestionPrompt(
  sessionId: SessionId,
  requestId: string,
  properties: Array<[string, ElicitationPropertySchema]>
): ElicitationQuestionForm | null {
  const ids = new Set(properties.map(([id]) => id));
  const fields: StandardChoiceField[] = [];
  const questions: AgentQuestion[] = [];
  for (const [id, field] of properties) {
    const choices = standardChoices(field);
    if (!choices?.length) {
      const owner = id.slice(0, -OTHER_FIELD_SUFFIX.length);
      if (field.type === "string" && id.endsWith(OTHER_FIELD_SUFFIX) && ids.has(owner)) continue;
      return null;
    }
    const noteId = ids.has(`${id}${OTHER_FIELD_SUFFIX}`) ? `${id}${OTHER_FIELD_SUFFIX}` : undefined;
    const multiSelect = field.type === "array";
    const { title, description } = field as StringPropertySchema | MultiSelectPropertySchema;
    fields.push({ id, choices, multiSelect, noteId });
    questions.push({
      question: title || id,
      ...(description ? { header: description } : {}),
      answerKey: id,
      options: choices.map((choice) => ({ label: choice.title })),
      ...(multiSelect ? { multiSelect } : {}),
      allowOther: noteId !== undefined,
    });
  }
  if (questions.length === 0) return null;

  return {
    prompt: { sessionId, requestId, questions },
    toContent: (answers) => {
      const content: ElicitationContent = {};
      for (const { id, choices, multiSelect, noteId } of fields) {
        const answer = answers[id];
        if (answer === undefined) continue;
        const labels = (multiSelect ? answer.split(MULTI_SELECT_SEPARATOR) : [answer]).filter(
          (label) => label.length > 0
        );
        const picked = labels.flatMap((label) => {
          const choice = choices.find((option) => option.title === label);
          return choice ? [choice.const] : [];
        });
        const other = labels.filter((label) => !choices.some((option) => option.title === label));
        if (multiSelect) content[id] = picked;
        else if (picked[0] !== undefined) content[id] = picked[0];
        if (noteId && other.length > 0) content[noteId] = other.join(MULTI_SELECT_SEPARATOR);
      }
      return content;
    },
  };
}
