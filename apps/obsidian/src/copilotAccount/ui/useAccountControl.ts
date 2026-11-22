import type { CopilotAccount } from "@/copilotAccount/copilotAccount";
import type { AccountControlProps } from "@/copilotAccount/ui/AccountControl";
import { useEffect, useMemo, useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};
const noState = () => null;

export function useAccountControl(account: CopilotAccount | undefined): AccountControlProps | null {
  const state = useSyncExternalStore(
    account?.subscribe ?? subscribeToNothing,
    account?.getSnapshot ?? noState
  );
  useEffect(() => {
    void account?.refreshProfile();
  }, [account]);
  return useMemo(
    () =>
      account && state
        ? {
            state,
            onSignIn: () => void account.signIn(),
            onOpenSignInPage: () => account.openSignInPage(),
            onCancelSignIn: () => account.cancelSignIn(),
            onRefreshPlan: () => void account.refreshProfile(),
            onSignOut: () => void account.signOut(),
          }
        : null,
    [account, state]
  );
}
