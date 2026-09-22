import type {
  CreateElicitationRequest,
  ElicitationSchema,
  EnumOption,
  MultiSelectPropertySchema,
  StringPropertySchema,
} from "@agentclientprotocol/sdk";
import type { AgentQuestion, AskUserQuestionPrompt, SessionId } from "@/agentMode/session/types";

function codexFlag(metadata: unknown, flag: string): boolean {
  return codexValue(metadata, flag) === true;
}

function codexValue(metadata: unknown, key: string): unknown {
  const codex =
    typeof metadata === "object" && metadata !== null && "codex" in metadata
      ? metadata.codex
      : null;
  return typeof codex === "object" && codex !== null
    ? (codex as Record<string, unknown>)[key]
    : undefined;
}

function hasUnsupportedStringConstraints(field: StringPropertySchema): boolean {
  return (
    field.minLength != null ||
    field.maxLength != null ||
    field.pattern != null ||
    field.format != null
  );
}

/** Convert the supported ACP form subset to the shared inline question contract. */
export function formToQuestionPrompt(
  request: CreateElicitationRequest,
  requestId: string
): AskUserQuestionPrompt | null {
  if (request.mode !== "form" || !("sessionId" in request) || !("requestedSchema" in request))
    return null;
  const schema = request.requestedSchema as ElicitationSchema;
  if (!schema || schema.type !== "object") return null;
  const properties = schema.properties ?? {};
  const ids = Object.keys(properties);
  if (ids.length === 0) return null;
  const questions: AgentQuestion[] = [];
  const required = new Set(schema.required ?? []);
  const noteIds = ids.filter((id) => codexValue(properties[id]._meta, "role") === "user_note");
  const consumed = new Set<string>();

  // The card requires each visible question. Decline optional schemas rather
  // than coerce an unanswered field into a required answer.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
  if (ids.some((id) => !noteIds.includes(id) && !required.has(id))) return null;
  if ([...required].some((id) => !ids.includes(id) || noteIds.includes(id))) return null;

  for (const id of ids) {
    if (noteIds.includes(id)) continue;
    const field = properties[id];
    const common = {
      question: typeof field.title === "string" && field.title ? field.title : id,
      ...(typeof field.description === "string" && field.description
        ? { header: field.description }
        : {}),
      answerKey: id,
    };
    if (field.type === "string") {
      const stringField = field as StringPropertySchema;
      if (hasUnsupportedStringConstraints(stringField)) return null;
      if (stringField.enum?.length && stringField.oneOf?.length) return null;
      if (stringField.oneOf?.length || stringField.enum?.length) {
        const choices: EnumOption[] =
          stringField.oneOf ?? stringField.enum!.map((value) => ({ const: value, title: value }));
        const isOther = codexFlag(stringField._meta, "isOther");
        const other = isOther
          ? choices.find((choice) => choice.const === "None of the above")
          : undefined;
        // The note ID may gain a suffix when another field already uses the
        // usual name; its metadata is the authoritative link to this choice.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
        const matchingNotes = noteIds.filter(
          (noteId) => codexValue(properties[noteId]._meta, "questionId") === id
        );
        if (
          matchingNotes.length > 1 ||
          (isOther && (!other || matchingNotes.length !== 1)) ||
          (!isOther && matchingNotes.length)
        )
          return null;
        const noteId = matchingNotes[0];
        const noteField = noteId ? (properties[noteId] as StringPropertySchema) : undefined;
        const hasNote = Boolean(noteId);
        if (
          noteField &&
          (properties[noteId].type !== "string" ||
            noteField.enum?.length ||
            noteField.oneOf?.length ||
            hasUnsupportedStringConstraints(noteField))
        )
          return null;
        if (noteId) consumed.add(noteId);
        const visible = choices.filter((choice) => !hasNote || choice !== other);
        if (new Set(visible.map((choice) => choice.title)).size !== visible.length) return null;
        questions.push({
          ...common,
          options: visible.map((choice) => ({
            label: choice.title,
            value: choice.const,
            ...(choice.description ? { description: choice.description } : {}),
          })),
          allowOther: Boolean(hasNote),
          ...(hasNote ? { otherOptionValue: other!.const, otherNoteKey: noteId } : {}),
          ...(noteField && codexFlag(noteField._meta, "isSecret")
            ? { otherInput: "secret" as const }
            : {}),
        });
      } else {
        questions.push({
          ...common,
          options: [],
          input: codexFlag(stringField._meta, "isSecret") ? "secret" : "text",
        });
      }
    } else if (field.type === "array") {
      const arrayField = field as MultiSelectPropertySchema;
      const items = arrayField.items;
      if (!items) return null;
      const choices: EnumOption[] | null =
        "anyOf" in items && Array.isArray(items.anyOf)
          ? (items.anyOf as EnumOption[])
          : "enum" in items && items.type === "string" && Array.isArray(items.enum)
            ? (items.enum as string[]).map((value) => ({ const: value, title: value }))
            : null;
      if (!choices?.length) return null;
      if (arrayField.minItems != null || arrayField.maxItems != null) return null;
      if (new Set(choices.map((choice) => choice.title)).size !== choices.length) return null;
      questions.push({
        ...common,
        options: choices.map((choice) => ({
          label: choice.title,
          value: choice.const,
          ...(choice.description ? { description: choice.description } : {}),
        })),
        multiSelect: true,
        allowOther: false,
      });
    } else {
      // A partial form could collect data the agent never receives correctly.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
      return null;
    }
  }
  if (consumed.size !== noteIds.length) return null;
  return {
    sessionId: request.sessionId as SessionId,
    requestId,
    message: request.message,
    questions,
  };
}
