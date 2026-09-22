Feature: Agent Mode against the real opencode runtime

  Copilot's own backend, config generation and ACP wiring drive the pinned
  opencode executable. Only the model provider is substituted, by a scripted
  localhost endpoint reached through Copilot's normal custom-provider setup.

  Background:
    Given an opencode runtime serving the models "model-a, model-b"

  Scenario: the assistant's answer reaches the conversation that asked for it
    Given the provider will answer "Alpha Bravo Charlie"
    When I open a conversation on "scripted/model-a"
    And I send "say the words"
    Then the conversation shows "Alpha Bravo Charlie"

  Scenario: selecting a model routes the turn to that model
    Given the provider will answer "answered by model B"
    When I open a conversation on "scripted/model-a"
    And I select the model "scripted/model-b"
    And I send "hello"
    Then the provider's last request used the model "model-b"
    And the conversation shows "answered by model B"

  Scenario: a cancelled turn does not leak into the next one
    Given the provider will answer "Cancelled words" and hold the stream open
    And the provider will then answer "Second answer"
    When I open a conversation on "scripted/model-a"
    And I send "first" without waiting for the turn to end
    And I cancel the turn once "Cancelled" has streamed
    Then the turn ended because it was cancelled
    When I send "second"
    Then the conversation shows "Second answer"
    And the conversation does not show "Cancelled"

  Scenario: denying a file edit leaves the file untouched
    Given the vault file "note.md" contains "original"
    And the provider will ask to write "rewritten" into the vault file "note.md"
    And I will deny every permission request
    When I open a conversation on "scripted/model-a"
    And I send "rewrite the note"
    Then Copilot was asked to approve the edit
    And the vault file "note.md" still contains "original"
