import { stripSpecialTokens } from "@/utils/stripSpecialTokens";

describe("stripSpecialTokens", () => {
  describe("stripSpecialTokens()", () => {
    it.each([
      ["ChatML", "<|im_end|>"],
      ["ChatML", "<|im_start|>"],
      ["Llama 3", "<|eot_id|>"],
      ["Llama 3", "<|start_header_id|>"],
      ["Llama 3", "<|end_header_id|>"],
      ["Gemma", "<end_of_turn>"],
      ["Gemma", "<start_of_turn>"],
      ["Phi", "<|end|>"],
      ["Phi", "<|assistant|>"],
      ["Phi", "<|user|>"],
      ["Phi", "<|system|>"],
      ["Mistral", "</s>"],
      ["Mistral", "[INST]"],
      ["Mistral", "[/INST]"],
      ["Qwen", "<|endoftext|>"],
      ["DeepSeek", "<|end▁of▁sentence|>"],
      ["Command R", "<|END_OF_TURN_TOKEN|>"],
      ["Command R", "<|START_OF_TURN_TOKEN|>"],
    ])("removes the %s token %s from the surrounding text", (_family, token) => {
      expect(stripSpecialTokens(`before${token}after`)).toBe("beforeafter");
    });

    it("strips tokens from different families in one pass", () => {
      expect(stripSpecialTokens("[INST]question[/INST]<|im_end|>answer<|eot_id|>")).toBe(
        "questionanswer"
      );
    });

    it("strips every occurrence of a repeated token", () => {
      expect(stripSpecialTokens("<|im_end|>text<|im_end|>more<|im_end|>")).toBe("textmore");
    });

    it("leaves normal text unchanged", () => {
      const text = "This is a perfectly normal response with no special tokens.";
      expect(stripSpecialTokens(text)).toBe(text);
    });

    it("leaves an empty string unchanged", () => {
      expect(stripSpecialTokens("")).toBe("");
    });

    it("leaves regular HTML tags unchanged", () => {
      const html = "<div>Hello <strong>world</strong></div>";
      expect(stripSpecialTokens(html)).toBe(html);
    });

    it("keeps <s> because it can appear in normal text, while still stripping a closing </s>", () => {
      expect(stripSpecialTokens("<s>beginning")).toBe("<s>beginning");
      expect(stripSpecialTokens("The <s>strikethrough</s> text here.")).toBe(
        "The <s>strikethrough text here."
      );
    });
  });
});
