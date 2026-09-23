Feature: Approving, rejecting, and blocking the agent's file edits

  The scripted model asks opencode to run one of its own tools on a note in a
  disposable vault, and opencode runs the real tool. The tool's name and
  arguments for the pinned opencode live in one fixture mapping in the steps;
  a scenario names only what the agent does to which note. The user answers a
  permission card through the card's own call, and the card is read as the
  chat draws it. Every file under the scenario's temp directory, other than
  opencode's own state, is compared byte for byte with how it started.

  Background:
    Given Copilot's opencode agent uses the scripted model "model-a" by default
    And the vault holds these notes:
      | note            | content        |
      | note.md         | Original line  |
      | other.md        | Unrelated line |
      | folder/child.md | Nested line    |

  # Default mode asks before an edit the chat's own agent makes, and Auto is only
  # ever the user's choice: https://github.com/Brevilabs/obsidian-copilot-private/issues/556
  # Not covered, listed in runtime-tests/README.md: an edit made through opencode's
  # task subagent does not ask:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/572
  # The card shows the edit's diff: https://github.com/Brevilabs/obsidian-copilot-private/issues/28
  Scenario Outline: An edit the user allows changes exactly that note, and the model is told the result
    When I open a new conversation
    And I send "Fix the note", and the model <change>
    Then the chat asks for permission with a card that reads:
      | Permission required                  |
      | Agent Mode wants to run $VAULT/note.md. |
      | Kind: edit                           |
      | $VAULT/note.md                       |
      | - Original line                      |
      | + <after>                            |
      | Allow once                           |
      | Always allow                         |
      | Reject                               |
    When I choose "Allow once" on the permission card, and the model then answers "Done"
    Then "note.md" reads "<after>", and no other file changed
    And Copilot wrote "<after>" to "note.md" through the vault
    And the model was told the result the chat shows for the tool call
    And the answer shows these tool calls:
      | tool call      | status    |
      | Edited note.md | completed |
    And the conversation shows exactly:
      | from | message      | turn ended as |
      | user | Fix the note |               |
      | ai   | Done         | end_turn      |

    # opencode has a tool that changes part of a note and one that replaces it.
    Examples:
      | change                                              | after          |
      | edits "note.md", replacing "Original" with "Edited" | Edited line    |
      | rewrites "note.md" as "Rewritten line"              | Rewritten line |

  # https://github.com/Brevilabs/obsidian-copilot-private/issues/556
  Scenario: An edit the user rejects leaves every file unchanged, and the chat carries on
    When I open a new conversation
    And I send "Fix the note", and the model edits "note.md", replacing "Original" with "Edited"
    And I choose "Reject" on the permission card
    Then no file changed
    And the answer shows these tool calls:
      | tool call      | status |
      | Edited note.md | failed |
    And the chat's status is "idle"
    When I send "Thanks", which the model answers with "You're welcome"
    Then the answer reads "You're welcome"
    And no file changed

  Scenario: A note the agent reads reaches the model without asking, and no file changes
    When I open a new conversation
    And I send "What does my other note say?", and the model reads "other.md", then answers "It says: Unrelated line"
    Then the chat asked for no permission
    And the model was told what "other.md" says
    And the answer shows these tool calls:
      | tool call     | status    |
      | Read other.md | completed |
    And no file changed

  # Auto is opencode's own build agent, which does not ask:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/556
  Scenario: In Auto mode the agent edits a note without asking
    When I open a new conversation
    And I choose "Auto" in the mode picker
    And I send "Fix the note", and the model edits "note.md", replacing "Original" with "Edited", then answers "Done"
    Then the chat asked for no permission
    And "note.md" reads "Edited line", and no other file changed
    And the model was told the result the chat shows for the tool call

  # A new conversation opens in the mode the user last chose:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/71
  # It must never start without asking: https://github.com/Brevilabs/obsidian-copilot-private/issues/556
  Scenario: A new chat's first edit asks when Default is saved, while another chat on the same opencode runs in Auto
    When I open conversation "A"
    And I choose "Auto" in the mode picker
    And I open conversation "B"
    Then the mode picker switches to "Auto"
    When I choose "Default" in the mode picker
    And I open conversation "C"
    And I send "Fix the note", and the model edits "note.md", replacing "Original" with "Edited"
    Then the chat asks for permission with a card that reads:
      | Permission required                  |
      | Agent Mode wants to run $VAULT/note.md. |
      | Kind: edit                           |
      | $VAULT/note.md                       |
      | - Original line                      |
      | + Edited line                        |
      | Allow once                           |
      | Always allow                         |
      | Reject                               |
    When I choose "Reject" on the permission card
    Then no file changed

  # An @-mentioned agent answers a multi-agent question read-only:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/12
  # Not covered, listed in runtime-tests/README.md: a shell command or a task subagent
  # in that answer can still write:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/573,
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/572
  Scenario Outline: An agent answering a read-only question cannot change a note
    When opencode is asked "Fix the note" as a read-only question, and the model <change>
    Then no file changed

    Examples:
      | change                                              |
      | edits "note.md", replacing "Original" with "Edited" |
      | rewrites "note.md" as "Rewritten line"              |

  # A read-only answer still runs shell commands, which Copilot's own relay skills
  # (web search, fetch) need: https://github.com/Brevilabs/obsidian-copilot-private/issues/138
  Scenario: An agent answering a read-only question can still run a shell command that reads a note
    When opencode is asked "What does my other note say?" as a read-only question, and the model runs "cat other.md", then answers "It says: Unrelated line"
    Then the model was told what "other.md" says
    And opencode's read-only answer reads "It says: Unrelated line"
    And no file changed
