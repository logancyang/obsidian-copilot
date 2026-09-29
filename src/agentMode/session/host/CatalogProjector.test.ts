import type { HostOp } from "@/agentMode/protocol/ops";
import { applyHostOp } from "@/agentMode/protocol/apply";
import { INITIAL_HOST_STATE, type HostState } from "@/agentMode/protocol/state";
import { buildBackendSummary } from "@/agentMode/protocol/testBuilders";
import { CatalogProjector } from "@/agentMode/session/host/CatalogProjector";
import { FakeCatalog } from "@/agentMode/session/host/hostTestHarness";

function build() {
  const catalog = new FakeCatalog();
  const ops: HostOp[] = [];
  let state: HostState = INITIAL_HOST_STATE;
  const projector = new CatalogProjector(
    catalog,
    () => state,
    (op) => {
      state = applyHostOp(state, op);
      ops.push(op);
    }
  );
  return { catalog, ops, projector, getState: () => state };
}

describe("CatalogProjector", () => {
  describe("refresh()", () => {
    it("sends every backend at its position and the flags that differ from the initial ones", () => {
      const { catalog, ops, projector, getState } = build();
      catalog.backends = [
        buildBackendSummary({ id: "claude" }),
        buildBackendSummary({ id: "codex" }),
      ];
      catalog.flags = { defaultBackendId: "codex", startingBackendId: null, startFailed: false };
      projector.refresh();
      expect(ops.map((op) => op.t)).toEqual(["backend.set", "backend.set", "host.patch"]);
      expect(getState().backends.map((b) => b.id)).toEqual(["claude", "codex"]);
      expect(ops[2]).toEqual({ t: "host.patch", patch: { defaultBackendId: "codex" } });
    });

    it("emits nothing when neither the catalog nor the flags changed", () => {
      const { catalog, ops, projector } = build();
      catalog.backends = [buildBackendSummary({ id: "claude" })];
      projector.refresh();
      ops.length = 0;
      projector.refresh();
      expect(ops).toEqual([]);
    });

    it("replaces only the backend whose content changed, even when the source builds fresh objects", () => {
      const { catalog, ops, projector } = build();
      catalog.backends = [
        buildBackendSummary({ id: "claude" }),
        buildBackendSummary({ id: "codex" }),
      ];
      projector.refresh();
      ops.length = 0;
      catalog.backends = [
        buildBackendSummary({ id: "claude" }),
        buildBackendSummary({ id: "codex", preload: "pending" }),
      ];
      projector.refresh();
      expect(ops).toEqual([
        {
          t: "backend.set",
          index: 1,
          backend: expect.objectContaining({ id: "codex", preload: "pending" }),
        },
      ]);
    });

    it("patches only the flags that changed, and reports a failed start as a boolean", () => {
      const { catalog, ops, projector } = build();
      projector.refresh();
      ops.length = 0;
      catalog.flags = { ...catalog.flags, startingBackendId: "claude" };
      projector.refresh();
      catalog.flags = { ...catalog.flags, startingBackendId: null, startFailed: true };
      projector.refresh();
      expect(ops).toEqual([
        { t: "host.patch", patch: { startingBackendId: "claude" } },
        { t: "host.patch", patch: { startingBackendId: null, startFailed: true } },
      ]);
    });
  });
});
