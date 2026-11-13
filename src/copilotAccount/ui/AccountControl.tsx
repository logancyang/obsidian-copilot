import type { AccountProfile, CopilotAccountState } from "@/copilotAccount/copilotAccount";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { cn } from "@/lib/utils";
import { openLinkInSystemBrowser } from "@/utils/electronShell";
import { ChevronDown, ExternalLink, Loader2, LogOut, RefreshCw, User } from "lucide-react";
import React, { useRef, useState } from "react";

export interface AccountControlProps {
  state: CopilotAccountState;
  onSignIn: () => void;
  onOpenSignInPage: () => void;
  onCancelSignIn: () => void;
  onRefreshPlan: () => void;
  onSignOut: () => void;
  defaultMenuOpen?: boolean;
}

const FREE_PLAN = "free";
const LIFETIME_PLAN = "believer";

function planName(plan: string): string {
  if (plan === LIFETIME_PLAN) return "Lifetime";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

interface AvatarProps {
  profile: AccountProfile | null;
}

function Avatar({ profile }: AvatarProps) {
  const initial = (profile?.name || profile?.email || "").charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="tw-flex tw-size-7 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-interactive-accent tw-text-ui-small tw-text-on-accent"
    >
      {initial || <User className="tw-size-4" />}
    </span>
  );
}

interface AccountMenuProps {
  profile: AccountProfile | null;
  onRefreshPlan: () => void;
  onSignOut: () => void;
  defaultOpen?: boolean;
}

function AccountMenu({ profile, onRefreshPlan, onSignOut, defaultOpen }: AccountMenuProps) {
  const menuContainer = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen ?? false);
  const plan = profile && planName(profile.plan);
  return (
    <div ref={menuContainer}>
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            aria-label={plan ? `Account, ${plan} plan` : "Account"}
            className={cn(
              "tw-h-9 tw-gap-2 tw-rounded-full tw-pl-1 tw-pr-2.5 tw-text-ui-small tw-font-semibold",
              profile &&
                profile.plan !== FREE_PLAN &&
                "clickable-icon tw-bg-success tw-text-success"
            )}
          >
            <Avatar profile={profile} />
            {plan ?? "Signed in"}
            <ChevronDown aria-hidden="true" className="tw-size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        {/* A menu outside the settings modal loses focus to the modal, which closes it at once.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/858 */}
        <DropdownMenuContent align="end" container={menuContainer.current} className="tw-w-56">
          {profile?.email && (
            <DropdownMenuLabel className="tw-truncate tw-font-normal tw-text-muted">
              {profile.email}
            </DropdownMenuLabel>
          )}
          <DropdownMenuItem asChild>
            <a
              href={createProductUrl(PRODUCT_URLS.COPILOT_DASHBOARD, "license_settings")}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                openLinkInSystemBrowser(event);
                // Opening the system browser cancels the link's click, which also stops the menu from closing itself.
                // https://github.com/Brevilabs/obsidian-copilot-private/issues/923
                setOpen(false);
              }}
              className="tw-text-normal tw-no-underline"
            >
              <ExternalLink />
              Dashboard
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRefreshPlan}>
            <RefreshCw />
            Refresh plan
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AccountControl({
  state,
  onSignIn,
  onOpenSignInPage,
  onCancelSignIn,
  onRefreshPlan,
  onSignOut,
  defaultMenuOpen,
}: AccountControlProps) {
  switch (state.status) {
    case "signed-out":
      return <Button onClick={onSignIn}>Sign in</Button>;
    case "signing-in":
      return (
        <>
          <span
            role="status"
            className="tw-flex tw-items-center tw-gap-2 tw-text-ui-small tw-font-medium"
          >
            <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin tw-text-accent" />
            Finish signing in in your browser
          </span>
          <Button variant="secondary" onClick={onOpenSignInPage}>
            Open page
          </Button>
          <Button variant="ghost" onClick={onCancelSignIn}>
            Cancel
          </Button>
        </>
      );
    case "signed-in":
      return (
        <AccountMenu
          profile={state.profile}
          onRefreshPlan={onRefreshPlan}
          onSignOut={onSignOut}
          defaultOpen={defaultMenuOpen}
        />
      );
  }
}
