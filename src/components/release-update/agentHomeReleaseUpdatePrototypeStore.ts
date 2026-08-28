type PrototypeListener = () => void;

let visible = false;
const listeners = new Set<PrototypeListener>();

export function getAgentHomeReleaseUpdatePrototype(): boolean {
  return visible;
}

export function setAgentHomeReleaseUpdatePrototype(nextVisible: boolean): void {
  visible = nextVisible;
  listeners.forEach((listener) => listener());
}

export function subscribeAgentHomeReleaseUpdatePrototype(listener: PrototypeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
