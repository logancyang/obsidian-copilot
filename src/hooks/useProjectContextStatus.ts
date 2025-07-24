import { ChainType } from "@/chainFactory";
import { useChainType, useProjectLoading, useProjectContextLoad } from "@/aiParams";

/**
 * Hook to calculate the project context status based on project loading state and context load state.
 * Returns one of: 'initial', 'loading', 'success', 'error'
 *
 * Status meanings:
 * - 'initial': Project context loading has not started yet or not in project mode
 * - 'loading': Project context is currently being loaded or files are being processed
 * - 'success': All files have been processed successfully without any errors
 * - 'error': One or more files have failed to process during the loading operation
 */

export type ProjectContextStatus = "initial" | "loading" | "success" | "error";

export function useProjectContextStatus(): ProjectContextStatus {
  const [currentChain] = useChainType();
  const [isProjectLoading] = useProjectLoading();
  const [contextLoadState] = useProjectContextLoad();

  const contextStatus = (() => {
    // Only calculate status for project mode
    if (currentChain !== ChainType.PROJECT_CHAIN) {
      return "initial";
    }

    const { total, success, failed, processingFiles } = contextLoadState;

    // Loading state: when project is loading or files are being processed
    if (isProjectLoading || processingFiles.length > 0) {
      return "loading";
    }

    // Error state: when there are failed files
    if (failed.length > 0) {
      return "error";
    }

    // Success state: when all files have been processed successfully
    if (total.length > 0 && success.length === total.length) {
      return "success";
    }

    // Initial state: when no context loading has started yet
    return "initial";
  })();

  return contextStatus;
}
