import { formToQuestionPrompt } from "@/agentMode/acp/elicitation";
import type { CreateElicitationRequest } from "@agentclientprotocol/sdk";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/551";

describe("elicitation", () => {
  describe("formToQuestionPrompt()", () => {
    it(`maps a Codex option and companion note into one question (${issue})`, () => {
      const request = {
        mode: "form",
        sessionId: "session-1",
        message: "Choose an approach",
        requestedSchema: {
          type: "object",
          required: ["approach"],
          properties: {
            approach: {
              type: "string",
              title: "Approach",
              description: "Pick one",
              _meta: { codex: { isOther: true } },
              oneOf: [
                { const: "simple", title: "Simple" },
                { const: "None of the above", title: "None of the above" },
              ],
            },
            approach_note1: {
              type: "string",
              title: "Details",
              _meta: { codex: { questionId: "approach", role: "user_note", isSecret: true } },
            },
          },
        },
      } as const satisfies CreateElicitationRequest;

      expect(formToQuestionPrompt(request, "rpc-1")).toEqual({
        sessionId: "session-1",
        requestId: "rpc-1",
        message: "Choose an approach",
        questions: [
          {
            question: "Approach",
            header: "Pick one",
            answerKey: "approach",
            options: [{ label: "Simple", value: "simple" }],
            allowOther: true,
            otherOptionValue: "None of the above",
            otherNoteKey: "approach_note1",
            otherInput: "secret",
          },
        ],
      });
    });

    it(`maps a string array to option values without flattening (${issue})`, () => {
      const request = {
        mode: "form",
        sessionId: "s",
        message: "Choose checks",
        requestedSchema: {
          type: "object",
          required: ["checks"],
          properties: {
            checks: {
              type: "array",
              title: "Checks",
              items: {
                anyOf: [
                  { const: "build", title: "Build" },
                  { const: "review", title: "Review" },
                ],
              },
            },
          },
        },
      } as const satisfies CreateElicitationRequest;
      expect(formToQuestionPrompt(request, "rpc-2")?.questions).toEqual([
        {
          question: "Checks",
          answerKey: "checks",
          options: [
            { label: "Build", value: "build" },
            { label: "Review", value: "review" },
          ],
          multiSelect: true,
          allowOther: false,
        },
      ]);
    });

    it(`maps free text and secret metadata to distinct inputs (${issue})`, () => {
      const request = {
        mode: "form",
        sessionId: "s",
        message: "Credentials",
        requestedSchema: {
          type: "object",
          required: ["reason", "token"],
          properties: {
            reason: { type: "string", title: "Reason" },
            token: { type: "string", title: "Token", _meta: { codex: { isSecret: true } } },
          },
        },
      } as const satisfies CreateElicitationRequest;
      expect(formToQuestionPrompt(request, "rpc-3")?.questions).toEqual([
        { question: "Reason", answerKey: "reason", input: "text", options: [] },
        { question: "Token", answerKey: "token", input: "secret", options: [] },
      ]);
    });

    it(`declines unsupported field shapes and request scopes (${issue})`, () => {
      const unsupported = {
        mode: "form",
        sessionId: "s",
        message: "Age",
        requestedSchema: { type: "object", properties: { age: { type: "number" } } },
      } as const satisfies CreateElicitationRequest;
      expect(formToQuestionPrompt(unsupported, "rpc-4")).toBeNull();
      expect(
        formToQuestionPrompt(
          {
            mode: "url",
            sessionId: "s",
            message: "Login",
            elicitationId: "id",
            url: "https://example.com",
          },
          "rpc-5"
        )
      ).toBeNull();
      expect(
        formToQuestionPrompt(
          {
            ...unsupported,
            sessionId: undefined,
            requestId: "init",
          },
          "rpc-6"
        )
      ).toBeNull();
    });

    it(`declines optional and ambiguous option fields instead of showing an unsatisfiable card (${issue})`, () => {
      expect(
        formToQuestionPrompt(
          {
            mode: "form",
            sessionId: "s",
            message: "Optional",
            requestedSchema: { type: "object", properties: { note: { type: "string" } } },
          },
          "rpc-7"
        )
      ).toBeNull();
      expect(
        formToQuestionPrompt(
          {
            mode: "form",
            sessionId: "s",
            message: "Duplicate",
            requestedSchema: {
              type: "object",
              required: ["choice"],
              properties: {
                choice: {
                  type: "string",
                  oneOf: [
                    { const: "a", title: "Same" },
                    { const: "b", title: "Same" },
                  ],
                },
              },
            },
          },
          "rpc-8"
        )
      ).toBeNull();
    });
  });
});
