/**
 * Agent task-planning steering — a backend-agnostic prompt section that tells the
 * agent WHEN to create a todo/plan list (and, just as importantly, when not to).
 *
 * It lives here, in the neutral `system-prompts` domain, so BOTH prompt builders
 * can consume the SAME text without a circular dependency:
 *  - `projects/projectSystemPrompt.ts` injects it today — Project scope only, so
 *    the global (no-project) prompt stays byte-identical.
 *  - `agentMode/backends/shared/agentSystemPrompt.ts` could push it globally later
 *    (see the seam comment there); single source, no duplicated wording.
 *
 * The wording rules are deliberate and load-bearing:
 *  - Threshold-style, never "always": trivial Q&A and single-step tasks must NOT
 *    trigger a plan, or the agent spams noise into the popover Progress section.
 *  - Generalized ("built-in todo/plan tool"), never a vendor tool name like
 *    TodoWrite / update_plan / TaskCreate — naming one backend's tool makes the
 *    others try to mimic an API they don't have.
 *  - "in the user's language" — a non-English request must not yield English todo
 *    items, since the same text renders in the live Progress section.
 */
export const AGENT_TODO_PLANNING_STEERING = `## Task planning
Use your built-in todo/plan tool for complex work so the user can follow your progress.

**When to plan:** the task takes roughly 3+ meaningful steps, spans multiple notes or files, or the user explicitly asks for a plan or checklist.
**When to skip:** simple questions, single-step tasks, or anything you can answer directly — an unnecessary plan is just noise.

When you plan:
- Write each item in the user's language.
- Keep exactly one item in progress at a time: mark it in progress before you start that step, and completed as soon as the work is actually done.
- Update the plan as scope changes — add steps you discover and drop ones that no longer apply.`;
