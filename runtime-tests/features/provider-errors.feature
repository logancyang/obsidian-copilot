Feature: Recovering from provider errors

  opencode retries a provider request that fails with a rate limit, a server
  error, or a dropped connection, and fails the turn when the retries run out or
  a retry is refused outright. The scripted provider answers every attempt, so
  each scenario checks that opencode retried; how many times is opencode's own
  policy, recorded in runtime-tests/README.md. A refusal that asks to retry at
  once (`retry-after-ms: 0`) keeps the scenario short: without it opencode backs
  off for about 70 seconds in all.

  Background:
    Given Copilot's opencode agent uses the scripted model "model-a" by default

  # A provider that kept failing left users watching a running turn with no reason:
  # https://github.com/logancyang/obsidian-copilot/issues/3104
  # https://github.com/logancyang/obsidian-copilot/issues/2980
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/553
  Scenario Outline: A provider that keeps answering <status> is retried, then its error is shown and the next message is answered
    Given the provider will refuse the next request with <status> "<message>", asking to retry at once
    And the model will answer "Next answer"
    When I open a new conversation
    And I send "Question"
    Then opencode retried "Question"
    And the conversation shows exactly:
      | from | message                              | turn ended as |
      | user | Question                             |               |
      | ai   | **Error:** Internal error: <message> |               |
    And the chat's status is "error"
    When I send "Next question"
    Then the conversation shows exactly:
      | from | message                              | turn ended as |
      | user | Question                             |               |
      | ai   | **Error:** Internal error: <message> |               |
      | user | Next question                        |               |
      | ai   | Next answer                          | end_turn      |
    And the chat's status is "idle"
    And the model was last asked "Next question"

    Examples:
      | status | message                                               |
      | 429    | Rate limit reached for requests                       |
      | 500    | The server had an error while processing your request |

  # An interrupted stream must end in an error that keeps the partial answer, not
  # hang: https://github.com/Brevilabs/obsidian-copilot-private/issues/163
  # Not covered, both listed in runtime-tests/README.md: the error's text is not drawn
  # once the reply has text (https://github.com/Brevilabs/obsidian-copilot-private/issues/388),
  # and a retry that succeeds repeats the words shown before the break
  # (https://github.com/Brevilabs/obsidian-copilot-private/issues/571).
  Scenario: A stream that breaks mid-answer is retried, and when the retry is refused the chat keeps the words shown and ends in error
    Given the model will start answering "Alpha Bravo" and then break
    And the provider will refuse the next request with 400 "Invalid value for messages"
    And the model will answer "Next answer"
    When I open a new conversation
    And I send "Question"
    Then opencode retried "Question"
    And the conversation shows exactly:
      | from | message     | turn ended as |
      | user | Question    |               |
      | ai   | Alpha Bravo |               |
    And the chat's status is "error"
    When I send "Next question"
    Then the conversation shows exactly:
      | from | message       | turn ended as |
      | user | Question      |               |
      | ai   | Alpha Bravo   |               |
      | user | Next question |               |
      | ai   | Next answer   | end_turn      |
    And the chat's status is "idle"
    And the model was last asked "Next question"
