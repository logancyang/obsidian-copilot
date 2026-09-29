import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { useEffect, useRef, useState } from "react";

interface UseRefreshEmptyLandingOnContextSourceChangeParams {
  activeProjectId: string;
  signature: string | null;
  isLanding: boolean;
  blocking: boolean;
  draftEmpty: boolean;
  refresh: () => Promise<boolean>;
}

export function useRefreshEmptyLandingOnContextSourceChange({
  activeProjectId,
  signature,
  isLanding,
  blocking,
  draftEmpty,
  refresh,
}: UseRefreshEmptyLandingOnContextSourceChangeParams): void {
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

  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (signature === null || activeProjectId === GLOBAL_SCOPE) {
      baselineRef.current = null;
      return;
    }

    const baseline = baselineRef.current;
    if (!baseline || baseline.projectId !== activeProjectId) {
      baselineRef.current = { projectId: activeProjectId, signature };
      return;
    }
    if (baseline.signature === signature) return;

    if (!isLanding) {
      baselineRef.current = { projectId: activeProjectId, signature };
      return;
    }

    if (!draftEmpty || blocking || inFlightRef.current) return;

    inFlightRef.current = true;
    void refreshRef
      .current()
      .then((replaced) => {
        if (replaced && mountedRef.current) {
          baselineRef.current = { projectId: activeProjectId, signature };
          setRetryTick((t) => t + 1);
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [signature, activeProjectId, isLanding, blocking, draftEmpty, retryTick]);
}
