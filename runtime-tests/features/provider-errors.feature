Feature: Recovering from provider errors

  opencode retries a provider request that fails with a rate limit, a server
  error, or a dropped connection, up to five times, and fails the turn when the
  retries run out or a retry is refused outright. The scripted provider answers
  every attempt, so each scenario asserts how many attempts opencode made. A
  refusal that asks to retry at once (`retry-after-ms: 0`) keeps the scenario
  short: without it opencode backs off for about 75 seconds in all.

  Background:
    Given Copilot's opencode agent uses the scripted model "model-a" by default
    When I open a new conversation

  # A provider that kept failing left users watching a running turn with no reason:
  # https://github.com/logancyang/obsidian-copilot/issues/3104
  # https://github.com/logancyang/obsidian-copilot/issues/2980
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/553
  Scenario Outline: A provider that keeps answering <status> is retried five times, then its error is shown and the next message is answered
    When I send "Question", which the provider refuses with <status> "<message>", asking to retry at once
    Then opencode sent "Question" to the provider 6 times
    And the conversation shows exactly:
      | from | message                              | turn ended as |
      | user | Question                             |               |
      | ai   | **Error:** Internal error: <message> |               |
    And the chat's status is "error"
    When I send "Next question", which the model answers with "Next answer"
    Then the conversation shows exactly:
      | from | message                              | turn ended as |
      | user | Question                             |               |
      | ai   | **Error:** Internal error: <message> |               |
      | user | Next question                        |               |
      | ai   | Next answer                          | end_turn      |
    And the chat's status is "idle"
    # A failed turn's question stays in opencode's history, with no reply.
    And the provider received this conversation with "Next question":
      | role | content       |
      | user | Question      |
      | user | Next question |

    Examples:
      | status | message                                               |
      | 429    | Rate limit reached for requests                       |
      | 500    | The server had an error while processing your request |

  # An interrupted stream must end in a visible error that keeps the partial answer,
  # not hang or repeat it: https://github.com/Brevilabs/obsidian-copilot-private/issues/163
  # Not covered: a retry that succeeds repeats the words shown before the break; see
  # runtime-tests/README.md.
  Scenario: A stream that breaks mid-answer is retried, and when the retry is refused the words shown stay with the error
    When I send "Question", which the model starts answering with "Alpha Bravo" and then holds
    And the provider refuses the next request with 400 "Invalid value for messages"
    And the held answer's connection breaks
    Then opencode sent "Question" to the provider 2 times
    And the conversation shows exactly:
      | from | message                                                              | turn ended as |
      | user | Question                                                             |               |
      | ai   | Alpha Bravo\n\n**Error:** Internal error: Invalid value for messages |               |
    And the chat's status is "error"
    When I send "Next question", which the model answers with "Next answer"
    Then the conversation shows exactly:
      | from | message                                                              | turn ended as |
      | user | Question                                                             |               |
      | ai   | Alpha Bravo\n\n**Error:** Internal error: Invalid value for messages |               |
      | user | Next question                                                        |               |
      | ai   | Next answer                                                          | end_turn      |
    And the chat's status is "idle"
    # opencode drops the broken attempt's words from its history.
    And the provider received this conversation with "Next question":
      | role | content       |
      | user | Question      |
      | user | Next question |
