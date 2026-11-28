import type { Provider } from "@/modelManagement/types/persisted";
import { isLoopbackUrl, isSelfHostedProvider, isSelfHostedUrl } from "./isSelfHostedProvider";

describe("isSelfHostedProvider", () => {
  describe("isSelfHostedUrl()", () => {
    it.each([
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234",
      "https://127.5.6.7",
      "http://0.0.0.0:8080",
      "http://10.0.0.2",
      "http://192.168.1.5:1234",
      "http://172.16.0.1",
      "http://172.31.255.254",
      "http://169.254.1.1",
      "http://[::1]:8080",
      "http://[fd00::1]:8080",
      "http://[fe80::1]",
      "http://[::ffff:127.0.0.1]:11434",
      "http://[::ffff:7f00:1]:11434",
      "http://[::ffff:10.0.0.1]",
      "http://[::ffff:a00:1]",
      "http://[::ffff:192.168.1.1]",
      "http://ollama.local:11434/v1",
      "http://mybox.lan",
      "http://gpu.internal:8000",
      "localhost:11434",
      "127.0.0.1:1234",
    ])("treats %s as self-hosted", (url) => {
      expect(isSelfHostedUrl(url)).toBe(true);
    });

    it.each([
      "https://api.openai.com/v1",
      "https://api.groq.com/openai/v1",
      "https://openrouter.ai/api/v1",
      "http://172.32.0.1",
      "http://11.0.0.1",
      "http://[::ffff:8.8.8.8]",
      undefined,
      "",
      "   ",
      "not a url",
    ])("does not treat %s as self-hosted", (url) => {
      expect(isSelfHostedUrl(url)).toBe(false);
    });
  });

  describe("isLoopbackUrl()", () => {
    it.each([
      ["http://localhost:11434/v1", true],
      ["http://127.0.0.1:1234", true],
      ["http://[::1]:8080", true],
      ["http://192.168.1.5:1234", false],
      ["https://api.openai.com/v1", false],
      [undefined, false],
    ])("reports whether %s is this computer", (url, expected) => {
      expect(isLoopbackUrl(url)).toBe(expected);
    });
  });

  describe("isSelfHostedProvider()", () => {
    const provider = (baseUrl?: string): Provider => ({
      providerId: "p1",
      providerType: "openai-compatible",
      displayName: "Test",
      baseUrl,
      origin: { kind: "byok" },
      addedAt: 0,
    });

    it("classifies a provider by its base URL", () => {
      expect(isSelfHostedProvider(provider("http://localhost:11434/v1"))).toBe(true);
      expect(isSelfHostedProvider(provider("https://api.openai.com/v1"))).toBe(false);
      expect(isSelfHostedProvider(provider(undefined))).toBe(false);
    });
  });
});
