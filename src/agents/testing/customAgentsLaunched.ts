import * as customAgentsGate from "@/agents/customAgentsGate";

let launchedConstant: jest.ReplaceProperty<boolean> | null = null;

afterEach(() => {
  launchedConstant?.restore();
  launchedConstant = null;
});

export function setCustomAgentsLaunched(launched: boolean): void {
  launchedConstant = jest.replaceProperty(customAgentsGate, "launched", launched);
}
