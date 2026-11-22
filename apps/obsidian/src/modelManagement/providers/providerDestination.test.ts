import type { Provider } from "@/modelManagement/types/persisted";
import { providerDestination, urlDestination } from "./providerDestination";

const provider = (origin: Provider["origin"], baseUrl?: string): Provider => ({
  providerId: "p1",
  providerType: "openai-compatible",
  displayName: "My Provider",
  baseUrl,
  origin,
  addedAt: 0,
});

describe("providerDestination", () => {
  describe("urlDestination()", () => {
    it.each([
      [undefined, { kind: "cloud", label: "Fallback" }],
      ["https://api.example.com/v1", { kind: "cloud", label: "Fallback" }],
      ["http://localhost:1234/v1", { kind: "local", label: "A server on this computer" }],
      ["http://10.0.0.5:8000/v1", { kind: "local", label: "A server on your local network" }],
    ])(
      "names %s for https://github.com/logancyang/obsidian-copilot/issues/2889",
      (baseUrl, expected) => {
        expect(urlDestination(baseUrl, "Fallback")).toEqual(expected);
      }
    );
  });

  describe("providerDestination()", () => {
    it("gives Copilot Plus the lock with Brevilabs servers for https://github.com/logancyang/obsidian-copilot/issues/2889", () => {
      expect(providerDestination(provider({ kind: "copilot-plus" }))).toEqual({
        kind: "lock",
        label: "Brevilabs servers (US)",
      });
    });

    it("names a BYOK provider by its own name, or the local server it points at", () => {
      expect(providerDestination(provider({ kind: "byok" }))).toEqual({
        kind: "cloud",
        label: "My Provider",
      });
      expect(providerDestination(provider({ kind: "byok" }, "http://127.0.0.1:11434"))).toEqual({
        kind: "local",
        label: "A server on this computer",
      });
    });
  });
});
