import { stripSpecialTokens } from "@/utils/stripSpecialTokens";

describe("stripSpecialTokens", () => {
  // --- Individual token stripping ---

  it("strips ChatML <|im_end|>", () => {
    expect(stripSpecialTokens("hello<|im_end|>")).toBe("hello");
  });

  it("strips ChatML <|im_start|>", () => {
    expect(stripSpecialTokens("<|im_start|>assistant")).toBe("assistant");
  });

  it("strips Llama 3 <|eot_id|>", () => {
    expect(stripSpecialTokens("done<|eot_id|>")).toBe("done");
  });

  it("strips Llama 3 <|start_header_id|>", () => {
    expect(stripSpecialTokens("<|start_header_id|>user")).toBe("user");
  });

  it("strips Llama 3 <|end_header_id|>", () => {
    expect(stripSpecialTokens("assistant<|end_header_id|>")).toBe("assistant");
  });

  it("strips Gemma <end_of_turn>", () => {
    expect(stripSpecialTokens("response<end_of_turn>")).toBe("response");
  });

  it("strips Gemma <start_of_turn>", () => {
    expect(stripSpecialTokens("<start_of_turn>model")).toBe("model");
  });

  it("strips Phi <|end|>", () => {
    expect(stripSpecialTokens("text<|end|>")).toBe("text");
  });

  it("strips Phi <|assistant|>", () => {
    expect(stripSpecialTokens("<|assistant|>answer")).toBe("answer");
  });

  it("strips Phi <|user|>", () => {
    expect(stripSpecialTokens("<|user|>question")).toBe("question");
  });

  it("strips Phi <|system|>", () => {
    expect(stripSpecialTokens("<|system|>prompt")).toBe("prompt");
  });

  it("strips Mistral </s>", () => {
    expect(stripSpecialTokens("end</s>")).toBe("end");
  });

  it("strips Mistral [INST]", () => {
    expect(stripSpecialTokens("[INST]input")).toBe("input");
  });

  it("strips Mistral [/INST]", () => {
    expect(stripSpecialTokens("output[/INST]")).toBe("output");
  });

  it("strips Qwen <|endoftext|>", () => {
    expect(stripSpecialTokens("text<|endoftext|>")).toBe("text");
  });

  it("strips DeepSeek <|end▁of▁sentence|>", () => {
    expect(stripSpecialTokens("sentence<|end\u2581of\u2581sentence|>")).toBe("sentence");
  });

  it("strips Command R <|END_OF_TURN_TOKEN|>", () => {
    expect(stripSpecialTokens("turn<|END_OF_TURN_TOKEN|>")).toBe("turn");
  });

  it("strips Command R <|START_OF_TURN_TOKEN|>", () => {
    expect(stripSpecialTokens("<|START_OF_TURN_TOKEN|>next")).toBe("next");
  });

  // --- Normal text is unchanged ---

  it("leaves normal text unchanged", () => {
    const text = "This is a perfectly normal response with no special tokens.";
    expect(stripSpecialTokens(text)).toBe(text);
  });

  it("leaves empty string unchanged", () => {
    expect(stripSpecialTokens("")).toBe("");
  });

  it("leaves text with regular angle brackets unchanged", () => {
    const html = "<div>Hello <strong>world</strong></div>";
    expect(stripSpecialTokens(html)).toBe(html);
  });

  it("does NOT strip <s> (can appear in normal text)", () => {
    // <s> alone is not in the strip list; </s> is (Mistral EOS token) and will be removed
    expect(stripSpecialTokens("<s>beginning")).toBe("<s>beginning");
  });

  it("strips </s> Mistral EOS even when preceded by HTML-looking <s>", () => {
    // </s> is always stripped as it is the Mistral end-of-sequence token
    expect(stripSpecialTokens("The <s>strikethrough</s> text here.")).toBe(
      "The <s>strikethrough text here."
    );
  });

  // --- Mixed content ---

  it("strips token at end of real text without affecting the rest", () => {
    expect(stripSpecialTokens("Here is the answer.<|im_end|>")).toBe("Here is the answer.");
  });

  it("strips token at start of real text without affecting the rest", () => {
    expect(stripSpecialTokens("<|im_start|>Here is the answer.")).toBe("Here is the answer.");
  });

  it("strips multiple tokens from a single chunk", () => {
    expect(stripSpecialTokens("<|im_start|>assistant\nHello there!<|im_end|>")).toBe(
      "assistant\nHello there!"
    );
  });

  it("strips tokens from different families in one pass", () => {
    expect(stripSpecialTokens("[INST]question[/INST]<|im_end|>answer<|eot_id|>")).toBe(
      "questionanswer"
    );
  });

  it("handles repeated occurrences of the same token", () => {
    expect(stripSpecialTokens("<|im_end|>text<|im_end|>more<|im_end|>")).toBe("textmore");
  });
});
