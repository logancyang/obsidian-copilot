Feature: Stopping an answer and switching chats while one is running

  The scripted provider can hold an answer open partway: it streams the first
  words, waits until the conversation shows them, then keeps the response open
  until the scenario releases or breaks it. The scenario stops an answer with
  the call the chat input's stop button makes, and switches chats the way
  clicking a tab does. Each streamed word waits until the conversation that
  asked shows it, so a word that reaches another chat stalls the answer and
  fails the scenario by name.

  Background:
    Given Copilot's opencode agent uses the scripted model "model-a" by default

  # Stop must abort opencode's request, keep the words shown, and leave the
  # session reusable: https://github.com/Brevilabs/obsidian-copilot-private/issues/163
  Scenario: A stopped answer keeps the words already shown, and the next message is answered after it
    Given the model will start answering "Partial answer" and then hold
    And the model will answer "Second answer"
    When I open a new conversation
    And I send "First question"
    And I stop the answer
    Then opencode closed the held answer's request
    And the chat's status is "idle"
    When I send "Second question"
    Then the conversation shows exactly:
      | from | message         | turn ended as |
      | user | First question  |               |
      | ai   | Partial answer  | cancelled     |
      | user | Second question |               |
      | ai   | Second answer   | end_turn      |
    And the model was last asked "Second question"

  # The incident in https://github.com/Brevilabs/obsidian-copilot-private/issues/163:
  # a stream failed after visible words, opencode retried it, and Stop could not
  # interrupt the retry. The stopped turn must keep the words shown, opencode must
  # not try again, and the next message must be answered.
  Scenario: An answer stopped while opencode waits to retry it keeps the words shown, and opencode does not try again
    Given the model will start answering "Alpha Bravo" and then break
    And the provider will refuse the next request with 500 "The server had an error while processing your request", asking to wait a minute
    And the model will answer "Next answer"
    When I open a new conversation
    And I send "Question"
    And I stop the answer
    Then the chat's status is "idle"
    When I send "Next question"
    Then the conversation shows exactly:
      | from | message       | turn ended as |
      | user | Question      |               |
      | ai   | Alpha Bravo   | cancelled     |
      | user | Next question |               |
      | ai   | Next answer   | end_turn      |
    And the model was last asked "Next question"
    And opencode made no more attempts at "Question" after the answer was stopped

  # Output must reach only the chat whose turn produced it, even with two turns in
  # flight on one agent process:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/276
  # A chat must not send another chat's conversation to the model:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/99
  # A chat whose turn ends while another tab is shown asks for attention:
  # https://github.com/logancyang/obsidian-copilot/issues/2987
  Scenario: An answer that resumes after the user switched chats lands only in the chat that asked
    Given the model will start answering "Alpha Bravo" and then hold
    And the model will answer "Answer B"
    When I open conversation "A"
    And I open conversation "B"
    And I switch to conversation "A"
    And I send "Question A"
    And I switch to conversation "B"
    Then the chat tabs show:
      | chat | shown | status  | needs attention |
      | A    | no    | running | no              |
      | B    | yes   | idle    | no              |
    When I send "Question B"
    And the model's held answer continues with "Charlie Delta"
    Then conversation "A" shows exactly:
      | from | message                   | turn ended as |
      | user | Question A                |               |
      | ai   | Alpha Bravo Charlie Delta | end_turn      |
    And conversation "B" shows exactly:
      | from | message    | turn ended as |
      | user | Question B |               |
      | ai   | Answer B   | end_turn      |
    And the chat tabs show:
      | chat | shown | status | needs attention |
      | A    | no    | idle   | yes             |
      | B    | yes   | idle   | no              |
    And the request for "Question B" carried no message conversation "A" sent
