/**
 * Which public conversation entries a backend session has already been given.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Text and voice context
 * continuity": context delivery and task execution are separate books, so
 * restoring conversation context can never rerun historical work.
 */
export interface ContextDeliveryState {
  /** Entries the backend accepted in a prompt. Never re-sent as context. */
  delivered: readonly string[];
  /**
   * Entries whose delivery could not be confirmed — the prompt failed after
   * it may already have reached the agent. Held back from automatic resend so
   * a disconnect cannot make the agent read the same request twice.
   */
  uncertain: readonly string[];
}

const EMPTY_IDS: readonly string[] = Object.freeze([]);

/** Nothing delivered yet. Frozen so an untouched cursor keeps one identity. */
export const EMPTY_CONTEXT_DELIVERY: ContextDeliveryState = Object.freeze({
  delivered: EMPTY_IDS,
  uncertain: EMPTY_IDS,
});

/**
 * Per-backend-session bookkeeping of context delivery for one conversation.
 * It records which public entries the agent has received and which ones are in
 * doubt, and it answers what a next prompt would still need to carry.
 *
 * It owns no prompt text and starts no work: composing the context block and
 * running turns belong to the session.
 */
export class ContextDeliveryCursor {
  private readonly delivered = new Set<string>();
  private readonly uncertain = new Set<string>();
  private snapshot: ContextDeliveryState = EMPTY_CONTEXT_DELIVERY;

  /**
   * Record that the backend accepted a prompt covering these entries. Called
   * on acceptance rather than on send, so a refused prompt leaves the entries
   * eligible for the next request.
   *
   * @param messageIds - Public entries the accepted prompt carried.
   */
  markDelivered(messageIds: readonly string[]): void {
    let changed = false;
    for (const id of messageIds) {
      if (!this.delivered.has(id)) {
        this.delivered.add(id);
        changed = true;
      }
      // Acceptance resolves an earlier doubt about the same entry.
      if (this.uncertain.delete(id)) changed = true;
    }
    if (changed) this.invalidate();
  }

  /**
   * Record that these entries may or may not have reached the backend. They
   * are never selected for automatic resend; only a new explicit user request
   * can carry them again.
   *
   * @param messageIds - Public entries whose delivery is in doubt.
   */
  markUncertain(messageIds: readonly string[]): void {
    let changed = false;
    for (const id of messageIds) {
      if (this.delivered.has(id)) continue;
      if (!this.uncertain.has(id)) {
        this.uncertain.add(id);
        changed = true;
      }
    }
    if (changed) this.invalidate();
  }

  /**
   * The entries a next prompt would still have to carry, in the order given.
   * Uncertain entries are excluded — see {@link markUncertain}.
   *
   * @param messageIds - Candidate public entries, newest last.
   */
  selectUndelivered(messageIds: readonly string[]): readonly string[] {
    const pending = messageIds.filter((id) => !this.delivered.has(id) && !this.uncertain.has(id));
    return pending.length > 0 ? pending : EMPTY_IDS;
  }

  /** Whether this entry's delivery was left in doubt by a failed prompt. */
  isUncertain(messageId: string): boolean {
    return this.uncertain.has(messageId);
  }

  /** Persistable snapshot; referentially stable until the cursor moves. */
  getState(): ContextDeliveryState {
    return this.snapshot;
  }

  /**
   * Adopt a saved cursor when a conversation is reopened, so reload does not
   * make the backend look unfed and re-deliver context it already has.
   *
   * @param state - Cursor read from a saved conversation snapshot.
   */
  restore(state: ContextDeliveryState): void {
    this.delivered.clear();
    this.uncertain.clear();
    for (const id of state.delivered) this.delivered.add(id);
    for (const id of state.uncertain) {
      if (!this.delivered.has(id)) this.uncertain.add(id);
    }
    this.invalidate();
  }

  private invalidate(): void {
    this.snapshot =
      this.delivered.size === 0 && this.uncertain.size === 0
        ? EMPTY_CONTEXT_DELIVERY
        : Object.freeze({
            delivered: Object.freeze([...this.delivered]),
            uncertain: Object.freeze([...this.uncertain]),
          });
  }
}
