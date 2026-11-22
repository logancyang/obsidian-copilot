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

    it(`declines forms that are not Codex questions (${issue})`, () => {
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
