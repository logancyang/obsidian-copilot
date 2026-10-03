import { PassThrough } from "node:stream";
import { AgyAcpAdapterServer } from "../adapters/companions/antigravity";

describe("antigravity", () => {
  describe("AgyAcpAdapterServer", () => {
    describe("getConfigOptions()", () => {
      it("uses the dynamically discovered model's exact effort levels and default", async () => {
        const server = new AgyAcpAdapterServer({
          spawnFn: () => {
            throw new Error("Unexpected CLI launch");
          },
          modelDiscovery: async () => "dynamic-low\tDynamic Low\ndynamic-high\tDynamic High\n",
          outputStream: new PassThrough(),
        });
        await server.handleClientLine(JSON.stringify({ id: 1, method: "session/new", params: {} }));
        const effort = server.getConfigOptions().find((option) => option.id === "reasoning_effort");
        expect(effort).toMatchObject({
          currentValue: "low",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        });
        expect(server.effectiveModelRequiresEffort("dynamic")).toBe(true);
        server.dispose();
      });
      it("reconciles a stored effort when changing to a model with fewer levels", async () => {
        const server = new AgyAcpAdapterServer({
          spawnFn: () => {
            throw new Error("Unexpected CLI launch");
          },
          modelDiscovery: async () =>
            "wide-low\tWide Low\nwide-medium\tWide Medium\nnarrow-high\tNarrow High\n",
          outputStream: new PassThrough(),
        });
        await server.handleClientLine(JSON.stringify({ id: 1, method: "session/new", params: {} }));
        await server.handleClientLine(
          JSON.stringify({
            id: 2,
            method: "session/set_config_option",
            params: { configId: "reasoning_effort", value: "medium" },
          })
        );
        await server.handleClientLine(
          JSON.stringify({
            id: 3,
            method: "session/set_config_option",
            params: { configId: "model", value: "narrow" },
          })
        );
        expect(
          server.getConfigOptions().find((option) => option.id === "reasoning_effort")?.currentValue
        ).toBe("high");
        server.dispose();
      });
      it("does not add a separate effort option for a fixed-effort model id", async () => {
        const server = new AgyAcpAdapterServer({
          spawnFn: () => {
            throw new Error("Unexpected CLI launch");
          },
          modelDiscovery: async () =>
            '[{"modelId":"gpt-oss-120b-medium","supportsReasoningEffort":false}]',
          outputStream: new PassThrough(),
        });
        await server.handleClientLine(JSON.stringify({ id: 1, method: "session/new", params: {} }));
        expect(server.getConfigOptions().some((option) => option.id === "reasoning_effort")).toBe(
          false
        );
        server.dispose();
      });
    });
  });
});
