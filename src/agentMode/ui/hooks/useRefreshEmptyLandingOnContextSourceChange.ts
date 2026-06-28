import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { useEffect, useRef, useState } from "react";

interface UseRefreshEmptyLandingOnContextSourceChangeParams {
  /** Active workspace scope; {@link GLOBAL_SCOPE} has no project context to track. */
  activeProjectId: string;
  /**
   * The active project's landing-capture signature, or null for global/orphaned
   * scope. Fingerprints the inputs an empty landing session bakes in at creation
   * — the materialized context sources PLUS the project instruction body — so a
   * System-Prompt-only edit triggers a refresh too. Broader than the session
   * manager's materialization dirty signature on purpose. Computed by the caller
   * from the live project record so it re-derives on every store change that
   * re-renders the host.
   */
  signature: string | null;
  /** Whether the active session is still an empty landing (no user messages). */
  isLanding: boolean;
  /** Context still materializing — replacing the session now would join a run
   * that's about to be discarded, so we defer until it clears. */
  blocking: boolean;
  /** A replace prunes the draft, so we only refresh when there's nothing to lose. */
  draftEmpty: boolean;
  /** Replaces the empty landing session in place; resolves to whether a swap
   * actually happened (false = guarded no-op, e.g. the draft filled in by the
   * time it ran), so the baseline only advances on a real capture. */
  refresh: () => Promise<boolean>;
}

/**
 * Refresh the empty landing session when the active project's captured inputs
 * change underneath it.
 *
 * Every project mutation — drag-drop, inline edit, +URL, chip removal, the
 * Manage modal, a System-Prompt edit — funnels through `updateProject` → the
 * project store, which re-renders the host. Observing the active project's
 * landing-capture signature here therefore covers every entry point (current and
 * future) without each mutation site wiring its own callback.
 *
 * The signature is the only trigger. A single-flight ref serializes the
 * (non-idempotent) session replacement. The baseline ref records the last
 * signature we've RECONCILED and only advances when a change is truly settled —
 * a successful refresh, or a deliberate accept (`!isLanding`). A change that's
 * merely deferred (blocking, in-flight, or a dirty draft) leaves the baseline
 * behind, so it's reconsidered the moment its gate clears: the draft emptying,
 * blocking ending, or the in-flight replace settling each re-runs the
 * evaluation. A FAILED refresh likewise leaves the baseline behind but does not
 * self-retry — it waits for the next real dependency change rather than looping.
 */
export function useRefreshEmptyLandingOnContextSourceChange({
  activeProjectId,
  signature,
  isLanding,
  blocking,
  draftEmpty,
  refresh,
}: UseRefreshEmptyLandingOnContextSourceChangeParams): void {
  // The refresh closure depends on the draft, so it changes every keystroke;
  // hold it in a ref so it never widens the evaluation effect's dependencies.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const baselineRef = useRef<{ projectId: string; signature: string } | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  // Bumped only after a SUCCESSFUL replace, to force one more evaluation that
  // converges a source change which arrived mid-flight (its signature already
  // changed during that render, so no dependency is left to re-trigger the
  // effect). A guarded no-op or a failure deliberately does NOT tick — those
  // wait for a real dependency change (draft emptying, signature/blocking
  // change) instead, so a persistent failure can't tight-loop.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    // Out of project scope: drop the baseline so re-entering a project re-seeds
    // rather than diffing against a stale signature.
    if (signature === null || activeProjectId === GLOBAL_SCOPE) {
      baselineRef.current = null;
      return;
    }

    const baseline = baselineRef.current;
    // First sight of this project (open or scope switch): seed, never refresh —
    // entering a project is not a source change.
    if (!baseline || baseline.projectId !== activeProjectId) {
      baselineRef.current = { projectId: activeProjectId, signature };
      return;
    }
    if (baseline.signature === signature) return;

    // Captured input changed on a surface that won't take a refresh: a
    // conversation, not a landing. Accept the new signature — the next New Chat
    // reads fresh config.
    if (!isLanding) {
      baselineRef.current = { projectId: activeProjectId, signature };
      return;
    }

    // Deferred — DON'T advance the baseline, so the change is reconsidered once
    // its gate clears: a dirty draft (emptying flips `draftEmpty`), an active
    // materialization (`blocking` flips via its atom), or an in-flight replace
    // (the retry tick below). Each is a dependency of this effect.
    if (!draftEmpty || blocking || inFlightRef.current) return;

    inFlightRef.current = true;
    void refreshRef
      .current()
      .then((replaced) => {
        // Advance the baseline only on a real capture; a guarded no-op or a
        // failure leaves it behind so a later evaluation retries. Tick only on
        // success — see {@link retryTick}.
        if (replaced && mountedRef.current) {
          baselineRef.current = { projectId: activeProjectId, signature };
          setRetryTick((t) => t + 1);
        }
      })
      .catch(() => {
        // `refresh` swallows its own errors and resolves false; this is purely
        // defensive so a rejection can't leave the single-flight latched.
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [signature, activeProjectId, isLanding, blocking, draftEmpty, retryTick]);
}
