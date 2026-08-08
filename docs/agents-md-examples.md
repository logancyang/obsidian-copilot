# AGENTS.md Examples Worth Studying

A shortlist of popular personal `AGENTS.md` files to use as references when writing your own. This is a personal-first list — global/user-level files, public "agent operating systems," and configurations that expose the author's real preferences. A few entries are product repositories, but they are still useful because they turn their creator's operating model into a reusable agent protocol.

**Popularity signal:** GitHub stars and X likes are capture-time snapshots from 2026-08-08 UTC, not a quality score.

**Rule of thumb:** borrow clauses and structure, not an entire file. Paths, tool names, work identities, and escalation rules are only good when they are true for your environment.

| #   | Example                                                                                                                                         | What Is Worth Borrowing                                                                                                                                                                                                                                                                                             | Popularity Signal               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | [Vaibhav (VB) Srivastav - compact personal AGENTS.md](https://x.com/reach_vb/status/2085832585025098101)                                        | A nine-bullet executive constitution: be concise and candid, use authoritative sources, preserve constraints, finish and verify work, use skills deliberately, and ask only when a decision is materially ambiguous or risky. A strong model for a short global core.                                               | 433 X likes on the shared post. |
| 2   | [Jessie Frazelle - `.codex/AGENTS.md`](https://raw.githubusercontent.com/jessfraz/dotfiles/main/.codex/AGENTS.md)                               | The maximalist personal operating manual: outcome-first mindset, scoped autonomy, tool routing, adversarial review, test philosophy, language-specific rules, and a real handoff standard. Borrow the sectioning and clarity, not the machine-specific details.                                                     | 3,559 GitHub stars.             |
| 3   | [Peter Steinberger - `agent-scripts/AGENTS.MD`](https://raw.githubusercontent.com/steipete/agent-scripts/main/AGENTS.MD)                        | A remarkably concrete staff-agent profile: communication voice, what "ship" means, skills as workflow owners, privacy/external-disclosure boundaries, review/CI rules, and identity-aware Git operations. Great reference for turning unwritten operator norms into explicit clauses.                               | 6,513 GitHub stars.             |
| 4   | [Garry Tan - GBrain `AGENTS.md`](https://raw.githubusercontent.com/garrytan/gbrain/master/AGENTS.md)                                            | A protocol file rather than a giant prompt: explicit read order, a mandatory user decision for a material cost choice, a trust boundary between local and remote callers, privacy guidance, and a concrete verification path. Study this when agents need to operate a persistent personal knowledge system safely. | 27,967 GitHub stars.            |
| 5   | [Garry Tan - gstack `AGENTS.md`](https://raw.githubusercontent.com/garrytan/gstack/main/AGENTS.md)                                              | Treats AGENTS.md as a router into composable roles and skills: CEO/design/engineering/QA/release reviews, browser workflows, memory, and safety scopes. The key idea is to keep recurring workflows in skills instead of bloating the global file.                                                                  | 126,820 GitHub stars.           |
| 6   | [Yutkat - global Codex rules](https://raw.githubusercontent.com/yutkat/dotfiles/main/.config/codex/AGENTS.md)                                   | A clean global baseline with response shape, instruction precedence, minimal-change discipline, lint/CI escalation order, verification expectations, and review output format. Particularly good at separating global defaults from more-local repository policy.                                                   | 980 GitHub stars.               |
| 7   | [Denys Dovhan - global agent instructions](https://raw.githubusercontent.com/denysdovhan/dotfiles/master/home/.config/agents/AGENTS.md)         | The best example of an AGENTS.md expressing a human interface preference, not just code style. It asks for concrete next actions, visible progress, capped lists, explicit estimates, focus protection, and a matter-of-fact error tone to accommodate ADHD.                                                        | 480 GitHub stars.               |
| 8   | [Kun Cheng - global agent instructions](https://raw.githubusercontent.com/kunchenguid/dotfiles/main/home/AGENTS.md)                             | A tiny but high-leverage global file: protect generated/changelog files, favor long-term quality over development cost, reproduce bugs end-to-end, care about visual quality, fix nearby flaky checks, and require approval before spawning a large swarm.                                                          | 461 GitHub stars.               |
| 9   | [Daniel Mulroy - Pi agent workspace](https://raw.githubusercontent.com/dmmulroy/.dotfiles/main/home/.pi/AGENTS.md)                              | A strong "map, don't narrate" pattern: a concise system diagram, a where-to-look table, conventions, anti-patterns, and sensitive-information boundaries. Ideal for making a personal agent environment navigable without stuffing implementation detail into every prompt.                                         | 815 GitHub stars.               |
| 10  | [JXNL - personal agent defaults](https://raw.githubusercontent.com/jxnl/dots/master/agents/AGENTS.md)                                           | A deliberately minimal policy set: use `uv`, do not mock tests just to pass, stage Git files deliberately, default to action, and state assumptions. Pair it with the repo's cross-tool prompt installer if you want one source to feed Claude, Codex, and Cursor.                                                  | 273 GitHub stars.               |
| 11  | [Dicklesworthstone - Agentic Coding Flywheel](https://raw.githubusercontent.com/Dicklesworthstone/agentic_coding_flywheel_setup/main/AGENTS.md) | The strongest safety-first counterexample: explicit user override, no deletion without written permission, a ban on dangerous commands, reversible alternatives, and documented confirmation. Intentionally forceful, but worth reading for how to specify a real safety boundary rather than a vague preference.   | 1,582 GitHub stars.             |
| 12  | [Liby - global Codex rules](https://raw.githubusercontent.com/liby/dotfiles/main/dot_codex/AGENTS.md)                                           | An evidence-and-capability-oriented policy: define observable success before editing, mark gaps as unverified, treat retrieved text as data rather than authority, protect secrets from model-visible surfaces, and require explicit authorization for high-impact external actions.                                | 112 GitHub stars.               |

## Patterns That Repeat Across the Strongest Files

1. **Outcome and evidence first.** The useful files define what "done" looks like and require real validation rather than a plausible narrative.
2. **Local instructions should win.** A personal/global file should be a baseline, not a way to erase repository-specific truth.
3. **Encode authorization boundaries precisely.** "Ask before risky external actions" is much more useful than "be careful."
4. **Use the file as a router.** Put stable defaults and navigation in AGENTS.md; put long workflows, tool recipes, and specialized expertise in skills or linked documents.
5. **Make it recognizably yours.** The file should encode how you actually want to work, not generic "best practices."

## A Good Starting Shape for a Personal AGENTS.md

Instead of copying any one file, assemble six compact layers:

1. **Communication:** outcome first, desired level of detail, language, formatting, and how to surface uncertainty.
2. **Autonomy:** what is authorized by an explicit request, what needs approval, and how to resolve ordinary ambiguity.
3. **Evidence:** when to use primary/current sources, how to label unverified conclusions, and what verification is expected.
4. **Safety:** secrets, destructive actions, production/external writes, identity boundaries, and protected files.
5. **Quality loop:** minimal-scope changes, test/review expectations, and an honest final handoff.
6. **Routing:** where skills, project instructions, and personal memory live — plus the local-over-global precedence rule.

For a first pass, aim for 20-50 durable rules rather than a giant document. Add a rule only after it prevents a recurring failure or captures a real preference; prune rules that merely restate generic advice.

## Suggested Reading Order

- **Want a compact personal core:** Vaibhav, Yutkat, JXNL, and Kun Cheng.
- **Want a full personal agent operating system:** Jessie Frazelle and Peter Steinberger.
- **Want a serious safety/evidence boundary:** Liby, GBrain, and Dicklesworthstone.
- **Want skills and durable agent context to scale:** GStack and Daniel Mulroy.
