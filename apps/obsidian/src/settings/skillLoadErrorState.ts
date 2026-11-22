import { atom, createStore, useAtomValue } from "jotai";

const skillLoadErrorStore = createStore();
const skillLoadErrorCountAtom = atom(0);

export function publishSkillLoadErrorCount(count: number): void {
  skillLoadErrorStore.set(skillLoadErrorCountAtom, count);
}

export function useSkillLoadErrorCount(): number {
  return useAtomValue(skillLoadErrorCountAtom, { store: skillLoadErrorStore });
}
