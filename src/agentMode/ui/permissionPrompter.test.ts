import { isExitPlanModePermission } from "./permissionPrompter";

describe("isExitPlanModePermission", () => {
  it("matches kind=switch_mode with rawInput.plan: string", () => {
    expect(
      isExitPlanModePermission({ kind: "switch_mode", rawInput: { plan: "# do thing" } })
    ).toBe(true);
  });

  it("rejects switch_mode without a plan body", () => {
    expect(isExitPlanModePermission({ kind: "switch_mode", rawInput: {} })).toBe(false);
  });

  it("rejects switch_mode with a non-string plan field", () => {
    expect(isExitPlanModePermission({ kind: "switch_mode", rawInput: { plan: 42 } })).toBe(false);
  });

  it("rejects other kinds even when rawInput.plan exists", () => {
    expect(isExitPlanModePermission({ kind: "edit", rawInput: { plan: "body" } })).toBe(false);
  });

  it("handles missing kind / rawInput defensively", () => {
    expect(isExitPlanModePermission({})).toBe(false);
    expect(isExitPlanModePermission({ kind: null })).toBe(false);
    expect(isExitPlanModePermission({ kind: "switch_mode" })).toBe(false);
    expect(isExitPlanModePermission({ kind: "switch_mode", rawInput: null })).toBe(false);
  });
});
