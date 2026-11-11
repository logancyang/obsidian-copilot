import { formToQuestionPrompt } from "@/agentMode/acp/elicitation";
import type { CreateElicitationRequest } from "@agentclientprotocol/sdk";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/551";

describe("elicitation", () => {
  describe("formToQuestionPrompt()", () => {
    it(`maps a Codex choice and its note field into one question that answers both fields (${issue})`, () => {
      const request = {
        mode: "form",
        sessionId: "session-1",
        message: "Codex needs your input to continue.",
        requestedSchema: {
          type: "object",
          required: ["approach"],
          properties: {
            approach: {
              type: "string",
              title: "Which approach?",
              description: "Approach",
              _meta: { codex: { isOther: true, isSecret: false } },
              oneOf: [
                { const: "Simple", title: "Simple", description: "Smallest change" },
                { const: "None of the above", title: "None of the above" },
              ],
            },
            approach_note: {
              type: "string",
              title: "Additional answer or note",
              _meta: { codex: { questionId: "approach", role: "user_note", isSecret: false } },
            },
          },
        },
      } as const satisfies CreateElicitationRequest;

      const form = formToQuestionPrompt(request, "rpc-1");
      expect(form?.prompt).toEqual({
        sessionId: "session-1",
        requestId: "rpc-1",
        questions: [
          {
            question: "Which approach?",
            header: "Approach",
            answerKey: "approach",
            options: [{ label: "Simple", description: "Smallest change" }],
            allowOther: true,
          },
        ],
      });
      expect(form?.toContent({ approach: "Simple" })).toEqual({ approach: "Simple" });
      expect(form?.toContent({ approach: "Use a script" })).toEqual({
        approach: "None of the above",
        approach_note: "Use a script",
      });
    });

    it(`maps a Codex question without a note field to one that hides Other (${issue})`, () => {
      const request = {
        mode: "form",
        sessionId: "s",
        message: "Codex needs your input to continue.",
        requestedSchema: {
          type: "object",
          required: ["mcp_install"],
          properties: {
            mcp_install: {
              type: "string",
              title: "Install MCP servers?",
              _meta: { codex: { isOther: false, isSecret: false } },
              oneOf: [
                { const: "Install", title: "Install" },
                { const: "Skip", title: "Skip" },
              ],
            },
          },
        },
      } as const satisfies CreateElicitationRequest;

      const form = formToQuestionPrompt(request, "rpc-2");
      expect(form?.prompt.questions).toEqual([
        {
          question: "Install MCP servers?",
          answerKey: "mcp_install",
          options: [{ label: "Install" }, { label: "Skip" }],
          allowOther: false,
        },
      ]);
      expect(form?.toContent({ mcp_install: "Skip" })).toEqual({ mcp_install: "Skip" });
    });

    it("maps a standard form's single choice, multi-select and paired _other fields into questions", () => {
      const request = {
        mode: "form",
        sessionId: "s",
        message: "The agent has 2 questions.",
        requestedSchema: {
          type: "object",
          properties: {
            q1: {
              type: "string",
              title: "Pick a size",
              oneOf: [
                { const: "1", title: "(Recommended) small - Ideal for a quick bite" },
                { const: "2", title: "large - Great for sharing" },
              ],
            },
            q1_other: { type: "string", title: "Other" },
            q2: {
              type: "array",
              title: "Pick toppings",
              items: {
                anyOf: [
                  { const: "1", title: "ham" },
                  { const: "2", title: "corn" },
                ],
              },
            },
          },
        },
      } as const satisfies CreateElicitationRequest;

      const form = formToQuestionPrompt(request, "rpc-5", true);

      expect(form?.prompt.questions).toEqual([
        {
          question: "Pick a size",
          answerKey: "q1",
          options: [
            { label: "(Recommended) small - Ideal for a quick bite" },
            { label: "large - Great for sharing" },
          ],
          allowOther: true,
        },
        {
          question: "Pick toppings",
          answerKey: "q2",
          options: [{ label: "ham" }, { label: "corn" }],
          multiSelect: true,
          answersAsList: true,
          allowOther: false,
        },
      ]);
      expect(form?.toContent({ q1: "large - Great for sharing", q2: ["ham", "corn"] })).toEqual({
        q1: "2",
        q2: ["1", "2"],
      });
      expect(form?.toContent({ q1: "medium please", q2: ["corn"] })).toEqual({
        q1_other: "medium please",
        q2: ["2"],
      });
    });

    it(`declines a standard choice form unless the backend accepts standard forms, as for any form that is not a Codex question (${issue})`, () => {
      const thirdParty = {
        mode: "form",
        sessionId: "s",
        message: "Pick a region",
        requestedSchema: {
          type: "object",
          properties: {
            region: { type: "string", oneOf: [{ const: "us", title: "US" }] },
          },
        },
      } as const satisfies CreateElicitationRequest;

      expect(formToQuestionPrompt(thirdParty, "rpc-3")).toBeNull();
      expect(formToQuestionPrompt(thirdParty, "rpc-3", true)?.toContent({ region: "US" })).toEqual({
        region: "us",
      });
    });

    it("maps each picked multi-select label to its value even when a label contains a comma, and sends typed text to the paired _other field", () => {
      const request = {
        mode: "form",
        sessionId: "s",
        message: "Seasoning",
        requestedSchema: {
          type: "object",
          properties: {
            spice: {
              type: "array",
              title: "Seasoning",
              items: {
                anyOf: [
                  { const: "sp", title: "salt, pepper" },
                  { const: "c", title: "chili" },
                ],
              },
            },
            spice_other: { type: "string", title: "Other" },
          },
        },
      } as const satisfies CreateElicitationRequest;

      const form = formToQuestionPrompt(request, "rpc-6", true);

      expect(form?.toContent({ spice: ["salt, pepper", "lemon, lime"] })).toEqual({
        spice: ["sp"],
        spice_other: "lemon, lime",
      });
    });

    it("offers no typed answer for a required choice field, so an accepted form always carries a listed value for it", () => {
      const request = {
        mode: "form",
        sessionId: "s",
        message: "Size",
        requestedSchema: {
          type: "object",
          required: ["size"],
          properties: {
            size: { type: "string", title: "Size", oneOf: [{ const: "s", title: "small" }] },
            size_other: { type: "string", title: "Other" },
          },
        },
      } as const satisfies CreateElicitationRequest;

      const form = formToQuestionPrompt(request, "rpc-7", true);

      expect(form?.prompt.questions.map((question) => question.allowOther)).toEqual([false]);
    });

    it(`declines forms with a field the question card cannot collect (${issue})`, () => {
      const freeText = {
        mode: "form",
        sessionId: "s",
        message: "Name the project",
        requestedSchema: {
          type: "object",
          properties: { name: { type: "string", title: "Project name" } },
        },
      } as const satisfies CreateElicitationRequest;
      expect(formToQuestionPrompt(freeText, "rpc-3")).toBeNull();
      expect(
        formToQuestionPrompt(
          {
            mode: "url",
            sessionId: "s",
            message: "Login",
            elicitationId: "id",
            url: "https://example.com",
          },
          "rpc-4"
        )
      ).toBeNull();
    });
  });
});
