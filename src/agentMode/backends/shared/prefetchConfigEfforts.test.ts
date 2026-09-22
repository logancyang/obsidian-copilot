import { prefetchConfigEfforts } from "./prefetchConfigEfforts";
import type {
  BackendProcess,
  BackendState,
  EffortOption,
  EnabledModelEntry,
  ModelState,
} from "@/agentMode/session/types";
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));
describe("prefetchConfigEfforts", () => {
  describe("prefetchConfigEfforts()", () => {
    const GPT = "github-copilot/gpt-5.4";
    const QWEN = "openrouter/qwen/qwen3.7-max";
    const NEMOTRON = "opencode/nemotron-3-super-free";
    const EFFORTS: Record<string, EffortOption[]> = {
      [GPT]: [
        { value: "low", label: "low" },
        { value: "high", label: "high" },
      ],
      [QWEN]: [],
    };

    function stateFor(baseModelId: string): BackendState {
      return {
        model: {
          current: { baseModelId, effort: null },
          apply: { kind: "setConfigOption", configId: "model" },
          availableModels: [
            {
              baseModelId,
              name: baseModelId,
              provider: null,
              effortOptions: EFFORTS[baseModelId] ?? [],
            },
          ],
        },
        mode: null,
      };
    }

    const modelState: ModelState = {
      current: { baseModelId: "orig/model", effort: null },
      apply: { kind: "setConfigOption", configId: "model" },
      availableModels: [],
    };

    function makeProc(impl: (value: string) => Promise<BackendState>): {
      proc: BackendProcess;
      setSessionConfigOption: jest.Mock;
    } {
      const setSessionConfigOption = jest.fn(
        async ({ value }: { sessionId: string; configId: string; value: string }) => impl(value)
      );
      return {
        proc: { setSessionConfigOption } as unknown as BackendProcess,
        setSessionConfigOption,
      };
    }

    const run = (
      proc: BackendProcess,
      enabledModels: EnabledModelEntry[],
      isAborted: () => boolean = () => false,
      state: ModelState = modelState
    ) =>
      prefetchConfigEfforts({
        proc,
        sessionId: "ses_1",
        modelState: state,
        enabledModels,
        isAborted,
      });

    it("collects effort only for models that report it, skips missing_key, and restores the original", async () => {
      const { proc, setSessionConfigOption } = makeProc((value) =>
        Promise.resolve(stateFor(value))
      );
      const result = await run(proc, [
        { baseModelId: GPT, name: "GPT-5.4", credentialState: "ok" },
        { baseModelId: QWEN, name: "Qwen", credentialState: "ok" },
        { baseModelId: NEMOTRON, name: "Nemotron", credentialState: "missing_key" },
      ]);

      expect(result).toEqual({ [GPT]: EFFORTS[GPT] });
      const values = setSessionConfigOption.mock.calls.map((c) => c[0].value);
      expect(values).not.toContain(NEMOTRON); // missing_key never probed
      expect(values).toEqual([GPT, QWEN, "orig/model"]); // restore is last
    });

    it("returns a frozen empty catalog and probes nothing when the catalog is not config-option-backed", async () => {
      const { proc, setSessionConfigOption } = makeProc((value) =>
        Promise.resolve(stateFor(value))
      );
      const result = await run(
        proc,
        [{ baseModelId: GPT, name: "GPT", credentialState: "ok" }],
        () => false,
        {
          ...modelState,
          apply: { kind: "setModel" },
        }
      );
      expect(Object.keys(result)).toHaveLength(0);
      expect(setSessionConfigOption).not.toHaveBeenCalled();
    });

    it("stops probing once isAborted() is true but still restores", async () => {
      const { proc, setSessionConfigOption } = makeProc((value) =>
        Promise.resolve(stateFor(value))
      );
      let probed = 0;
      await run(
        proc,
        [
          { baseModelId: GPT, name: "GPT", credentialState: "ok" },
          { baseModelId: QWEN, name: "Qwen", credentialState: "ok" },
        ],
        () => probed++ >= 1 // false for the first model, true thereafter
      );
      const values = setSessionConfigOption.mock.calls.map((c) => c[0].value);
      expect(values).toEqual([GPT, "orig/model"]); // QWEN skipped, restore still runs
    });

    it("survives a throwing probe, keeps going, and still restores", async () => {
      const { proc, setSessionConfigOption } = makeProc((value) => {
        if (value === GPT) return Promise.reject(new Error("boom"));
        return Promise.resolve(stateFor(value));
      });
      const result = await run(proc, [
        { baseModelId: GPT, name: "GPT", credentialState: "ok" },
        { baseModelId: QWEN, name: "Qwen", credentialState: "ok" },
      ]);
      expect(result).toEqual({}); // GPT threw, QWEN has no effort
      expect(setSessionConfigOption.mock.calls.map((c) => c[0].value)).toEqual([
        GPT,
        QWEN,
        "orig/model",
      ]);
    });
  });
});
