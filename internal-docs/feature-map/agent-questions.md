# Agent questions

`Question from agent` cards at the bottom of the conversation, where the agent waits for the user to pick or type an answer.

## Sub-features

- card-question: `Question from agent` offers answers to pick, or `Other` to type one, then `Submit` (`Next` when it asks several questions) or `Cancel`.
- next-on-pick: when it asks several questions, clicking an answer to a pick-one question shows the next question without `Next`.

## How to get to it

Ask the agent to ask you something with choices.

## Driving it

- Question: ask Claude to ask which color you prefer, with options Red and Blue. `Question from agent` lists Red, Blue, and `Other`; `Submit` stays disabled until you pick. Choose `Other`, type Green, choose `Submit`. The trail reads `Answered: Green` and the agent replies with Green.
- Several questions: ask Claude to ask two pick-one questions at once. Click an answer to the first. The card shows the second question; click an answer there and `Submit` stays on screen for you to choose.

## Gotchas

- A question from a background subagent shows only in the main conversation, never in the task's own view.
