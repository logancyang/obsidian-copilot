import { useAtMentionCategories } from "@/components/chat-components/hooks/useAtMentionCategories";
import { renderHook } from "@testing-library/react";

jest.mock("@/i18n", () => ({
  t: (key: string) =>
    ({
      "agentChat.context.agents": "智能体",
      "agentChat.context.agentsDescription": "让另一个编程智能体参与本轮任务",
      "agentChat.context.notes": "笔记",
      "agentChat.context.notesDescription": "引用仓库中的笔记",
    })[key] ?? key,
}));

describe("useAtMentionCategories", () => {
  describe("useAtMentionCategories()", () => {
    it("localizes Agent categories without changing Quick Chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/326", () => {
      const { result, rerender } = renderHook(
        ({ localize }) => useAtMentionCategories(false, true, localize),
        { initialProps: { localize: false } }
      );
      expect(result.current[0]).toMatchObject({ title: "Agents" });
      expect(result.current.find((option) => option.category === "notes")).toMatchObject({
        title: "Notes",
      });

      rerender({ localize: true });
      expect(result.current[0]).toMatchObject({ title: "智能体" });
      expect(result.current.find((option) => option.category === "notes")).toMatchObject({
        title: "笔记",
      });
    });
  });
});
