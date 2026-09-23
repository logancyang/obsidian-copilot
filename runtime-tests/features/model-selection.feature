Feature: Choosing the model, effort, and mode a conversation runs on

  Copilot turns its settings into opencode's config: every BYOK provider row
  becomes an opencode provider pointed at that row's endpoint. The chat's
  model, effort, and mode pickers are built by production code from what the
  running opencode reports, and every pick goes through the pickers' own
  callbacks. Two scripted OpenAI-compatible endpoints stand in for two
  providers. Each answers only the models configured on it, so a request that
  reaches the wrong endpoint or names the wrong model fails the scenario. The
  effort levels are the ones opencode itself advertises for an
  OpenAI-compatible model that declares reasoning.

  Background:
    Given Copilot's opencode agent is configured with these scripted models:
      | provider | model   | reasoning |
      | alpha    | model-a | no        |
      | bravo    | model-b | yes       |

  # Switching models mid-session crashed opencode:
  # https://github.com/logancyang/obsidian-copilot/issues/2898
  # BYOK OpenAI-compatible models were not offered through opencode:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/76
  Scenario Outline: A model picked mid-conversation at <effort> effort reaches that model's endpoint with that effort
    Given Copilot starts with opencode's default model set to "model-a" with no effort
    And the model will answer "First answer"
    And the model will answer "Second answer"
    When I open a new conversation
    Then the model picker offers exactly:
      | model         | effort levels              |
      | alpha/model-a |                            |
      | bravo/model-b | low, medium, high, default |
    And the model picker shows "alpha/model-a" with no effort
    When I send "First question"
    And I pick "bravo/model-b" at "<effort>" effort in the model picker
    Then the model picker shows "bravo/model-b" at "<effort>" effort
    When I send "Second question"
    Then the provider answered these agent turns:
      | endpoint | model   | reasoning effort |
      | alpha    | model-a |                  |
      | bravo    | model-b | <sent>           |
    And the conversation shows exactly:
      | from | message         | turn ended as |
      | user | First question  |               |
      | ai   | First answer    | end_turn      |
      | user | Second question |               |
      | ai   | Second answer   | end_turn      |

    # One example per level: each checks opencode's own mapping of that level onto
    # the request, which the OpenCode V2 migration changes.
    Examples:
      | effort  | sent   |
      | low     | low    |
      | medium  | medium |
      | high    | high   |
      | default |        |

  # A new conversation must open in the mode the user last chose:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/71
  Scenario: The mode picked in a conversation is confirmed and the next new conversation switches to it
    Given Copilot starts with opencode's default model set to "model-a" with no effort
    When I open a new conversation
    Then the mode picker offers "Default, Auto"
    And the mode picker shows "Default"
    When I choose "Auto" in the mode picker
    And I open a new conversation
    Then the mode picker shows "Auto"

  # A restart resumes each open conversation instead of replacing it:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/475
  # A pick made after the last turn, or in a chat with no turns, is not restored;
  # see the two known gaps that follow.
  Scenario: A conversation continues on the model and effort of its last turn after opencode restarts
    Given Copilot starts with opencode's default model set to "model-a" with no effort
    And the model will answer "First answer"
    And the model will answer "Second answer"
    And the model will answer "Third answer"
    When I open a new conversation
    And I pick "bravo/model-b" at "high" effort in the model picker
    And I send "First question"
    And I choose "medium" in the effort picker
    And I send "Second question"
    And I restart opencode from the chat's Reload action
    Then the model picker shows "bravo/model-b" at "medium" effort
    When I send "Third question"
    Then the provider answered these agent turns:
      | endpoint | model   | reasoning effort |
      | bravo    | model-b | high             |
      | bravo    | model-b | medium           |
      | bravo    | model-b | medium           |
    # Turns replayed from opencode's history carry no stop reason.
    And the conversation shows exactly:
      | from | message         | turn ended as |
      | user | First question  |               |
      | ai   | First answer    |               |
      | user | Second question |               |
      | ai   | Second answer   |               |
      | user | Third question  |               |
      | ai   | Third answer    | end_turn      |

  @known-gap
  Scenario: A model picked after the chat's last turn is still picked after opencode restarts
    Unverified: https://github.com/logancyang/obsidian-copilot/issues/3319, with an open fix
    in https://github.com/logancyang/obsidian-copilot/pull/3323.
    Release consequence: after the Reload action, the next message runs on a model and
    provider the user did not pick, and nothing on screen says so.
    Fails today with: 'alpha/model-a'

    Given Copilot starts with opencode's default model set to "model-a" with no effort
    And the model will answer "First answer"
    When I open a new conversation
    And I send "First question"
    And I pick "bravo/model-b" at "high" effort in the model picker
    And I restart opencode from the chat's Reload action
    Then the model picker shows "bravo/model-b" at "high" effort

  @known-gap
  Scenario: A chat with no turns is still on the saved default model after opencode restarts
    Unverified: https://github.com/logancyang/obsidian-copilot/issues/3319, with an open fix
    in https://github.com/logancyang/obsidian-copilot/pull/3323.
    Release consequence: after the Reload action, a BYOK user's first message goes to
    OpenCode Zen, a hosted service they never configured.
    Fails today with: 'OpenCode Zen/Big Pickle'

    Given Copilot starts with opencode's default model set to "model-b" at "high" effort
    When I open a new conversation
    Then the model picker shows "bravo/model-b" at "high" effort
    When I restart opencode from the chat's Reload action
    Then the model picker shows "bravo/model-b" at "high" effort

  # New conversations kept opencode's own effort instead of the saved one:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/201
  Scenario: A new conversation starts on the default model and effort saved in settings
    Given Copilot starts with opencode's default model set to "model-a" with no effort
    And the model will answer "Answer"
    When I set opencode's default model to "model-b" at "high" effort in settings
    And I open a new conversation
    Then the model picker shows "bravo/model-b" at "high" effort
    When I send "Question"
    Then the provider answered these agent turns:
      | endpoint | model   | reasoning effort |
      | bravo    | model-b | high             |

  # A saved default the agent no longer offered silently ran the agent's own model:
  # https://github.com/Brevilabs/obsidian-copilot-private/issues/474
  Scenario: A saved default model that is turned off gives way to an enabled model, and the user is told
    Given Copilot starts with opencode's default model set to "model-b" at "high" effort
    And the model will answer "Answer"
    When I turn off "model-b" for opencode in settings
    And I open a new conversation
    Then the model picker offers exactly:
      | model         | effort levels |
      | alpha/model-a |               |
    And the model picker shows "alpha/model-a" with no effort
    And Copilot showed exactly these notices:
      | opencode no longer offers model-b. New chats use model-a until you pick a new default. |
    When I send "Question"
    Then the provider answered these agent turns:
      | endpoint | model   | reasoning effort |
      | alpha    | model-a |                  |
    And opencode's saved default is "model-b" at "high" effort

  # A saved effort the default model did not offer made new conversations open on
  # opencode's own model: https://github.com/Brevilabs/obsidian-copilot-private/issues/364
  # The saved default drops that effort: https://github.com/Brevilabs/obsidian-copilot-private/issues/219
  Scenario: A saved effort on a default model with no effort levels is dropped instead of changing the model
    Given Copilot starts with opencode's default model set to "model-a" at "high" effort
    And the model will answer "Answer"
    When I open a new conversation
    Then the model picker shows "alpha/model-a" with no effort
    When I send "Question"
    Then the provider answered these agent turns:
      | endpoint | model   | reasoning effort |
      | alpha    | model-a |                  |
    And opencode's saved default is "model-a" with no effort
