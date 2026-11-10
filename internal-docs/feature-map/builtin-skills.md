# Built-in skills

The Built-in skills table shows bundled skills, their availability, and per-agent switches.

## Sub-features

- builtin-availability: web search, web fetch, YouTube transcripts, and X require active Plus access and a configured license key. When unavailable, their agent switches are off and disabled, with an explanation.
- builtin-preferences: saved whole-skill and per-agent choices apply again when Plus becomes active. Free Obsidian skills stay available.

## How to get to it

- Settings → Copilot → Skills → Built-in skills.

## Driving it

- Availability: with Plus inactive, inspect a bundled web skill. Its agent switches are off and unavailable; the warning explains that active Copilot Plus is required. A disabled skill's More actions menu cannot enable it.
- Preferences: with Plus active, enable web search for one installed agent, then deactivate Plus. The switches become unavailable. Restore Plus and confirm the saved choice returns. Check that a free Obsidian skill remains available throughout.

## Gotchas

- A skill can remain in an already-running agent's context until its skills refresh or the chat is reloaded. A script invoked from stale context still refuses unavailable Plus access.
- Becoming unavailable preserves saved choices rather than resetting them.
