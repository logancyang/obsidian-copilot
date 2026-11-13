# Copilot license

The `Copilot license` section at the top of Copilot settings' Basic tab: what the paid plans add, signing in to a Copilot account, the license key, the plan badge, and how much of the plan's allowance is used.

## Sub-features

- license-description: the title carries the Copilot icon, and the description links `Copilot paid plans`, `OpenArtifacts` and `Miyo`.
- account-sign-in: on desktop, everyone signed out sees `Sign in` at the right of the title, next to the plan badge when a license key is applied. It opens the Copilot website in the browser.
- account-signing-in: while the browser is open, that spot reads `Finish signing in in your browser` with `Open page` and `Cancel`.
- account-sign-in-failure: a cancelled, failed or timed-out sign-in says what happened under the title and leaves any applied license as it was.
- account-pill: once signed in, that spot is one pill with the account's picture or initial and its plan: `Free`, `Lite`, `Plus` or `Lifetime`. The plan badge is gone.
- account-menu: the pill opens a menu with the account's email, `Dashboard`, `Refresh plan` and `Sign out`. `Refresh plan` reads the account's plan again.
- account-sign-out: `Sign out` brings back `Sign in` and ends the sign-in on the website too. A pasted license key stays.
- license-key-row: while no license is active, the section ends with `Enter your license key`, `Apply` and `See plans`. `See plans` opens the pricing page.
- license-apply: `Apply` checks the key. A key that works shows the plan badge and a welcome; one that does not reads `Invalid license key` and the badge `Inactive`.
- license-badge: an active license shows its plan at the right of the title, `Lifetime` for a lifetime purchase.
- license-usage: while a license is active, the key row is gone and the section ends with how much of the 5-hour and weekly allowance is used, such as `5h 12% used` and `Weekly 34% used`. When usage cannot be read, the line shows `Remove license` alone.
- license-remove: `Remove license` asks `Remove license?`, which says the plan itself is not affected; confirming brings back an empty key row.

## How to get to it

- Settings → Copilot → Basic, at the top.
- `Already a Supporter? Enter your license key` on the [Connectors tab](connectors-tab.md).

## Driving it

- Sign in: choose `Sign in`, then sign in or sign up on the website. The browser page reads `You're signed in to Copilot`, and the section shows the pill with the account's plan.
- Signing in: choose `Sign in` and leave the browser page open. The section reads `Finish signing in in your browser`; `Open page` opens the same page again and `Cancel` brings back `Sign in` with `Sign-in cancelled.`
- Account menu: choose the pill. The menu shows the account's email, `Dashboard`, `Refresh plan` and `Sign out`.
- Refresh plan: change the account's plan on the website, then choose `Refresh plan`. The pill shows the new plan.
- Sign out: choose `Sign out` from the menu. `Sign in` returns, and a pasted license key keeps its badge.
- Key row: with no license applied, open the Basic tab. The key row shows with `See plans`, and the Agents settings below are in view without scrolling.
- Apply: enter a valid key and choose `Apply`. The plan badge shows, the key row is gone, and the usage line shows.
- Invalid key: enter a wrong key and choose `Apply`. `Invalid license key` shows under the key row and the badge reads `Inactive`.
- Usage: with a license active, open the Basic tab. The usage line shows the 5-hour and weekly percentages next to `Remove license`.
- Remove license: choose `Remove license`, then confirm. The badge and usage line go away and the key row returns empty.

## Gotchas

- The sign-in stays across restarts. The account's plan is read when Copilot starts and each time the settings open; a sign-in the website has ended shows as signed out at the next read.
- The account's plan only labels the pill; a paid account still needs its license key applied for paid features.
- Mobile shows no `Sign in`.
- Usage is read each time the settings open; it does not update while they stay open.
- Once applied, a key cannot be shown again in settings. Users who need it copy it from their Copilot dashboard.
