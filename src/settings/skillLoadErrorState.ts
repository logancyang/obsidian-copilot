import { atom, createStore, useAtomValue } from "jotai";

const skillLoadErrorStore = createStore();
const skillLoadErrorCountAtom = atom(0);

/** Publish the latest number of discovered skills that agents cannot load. */
export function publishSkillLoadErrorCount(count: number): void {
  skillLoadErrorStore.set(skillLoadErrorCountAtom, count);
}

/** Subscribe to the current number of discovered skills that agents cannot load. */
export function useSkillLoadErrorCount(): number {
  return useAtomValue(skillLoadErrorCountAtom, { store: skillLoadErrorStore });
}
