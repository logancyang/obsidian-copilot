Feature: Streaming an answer through the real opencode runtime

  Copilot's session layer, config generation, and ACP client drive the pinned
  opencode executable. Only the model provider is substituted, by a scripted
  localhost endpoint that Copilot reaches through its normal custom-provider
  setup. The provider sends each word only after the previous one is visible
  in the conversation, so the order the words appear in is observable.

  Scenario: A streamed answer appears in the conversation word by word and then completes
    Given Copilot's opencode agent uses the scripted model "model-a" by default
    And the model will answer "Alpha Bravo Charlie"
    When I send "Say the three words" in a new conversation
    Then the answer grew in the conversation as:
      | Alpha               |
      | Alpha Bravo         |
      | Alpha Bravo Charlie |
    And the turn completed normally after its last word
