# Gallery review coverage

This bounded pass supports [UI audit issue 427](https://github.com/Brevilabs/obsidian-copilot-private/issues/427). It does not certify real services or complete user journeys. Snapshot base: `20837e1973386ba374c80ac1d7bd12a966cd5432`.

## Representative review set

| Need                            | Story ID                                                                    | Interaction and boundary                                                                                                                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked catalog                  | `Agent Mode/Model Enable List/LockedCopilotCatalog`                         | Copilot rows stay locked; BYOK rows remain visible. Complete meta args supply the required controlled query and handlers. This is a static catalog fixture, not model configuration.                                                                                                                        |
| Full native settings host       | `Settings/Quick Chat models/Configured`, `Settings/Quick Chat models/Empty` | Existing composite section includes its heading, default selector and model list inside the gallery's `.modal.mod-settings` / `.vertical-tab-content` host. This tests section and host geometry; it is not the entire Copilot Settings page, settings navigation or persistence.                           |
| Open menu                       | `UI/Model Selector/Unlicensed`                                              | Open the host popover, then open the model dropdown. Inspect long provider/model IDs, locked rows and lock explanations. Capture the open dropdown, not only its closed trigger.                                                                                                                            |
| Permission diffs                | `Agent Mode/Tool Permission Card/MultipleFiles`                             | Two note paths and their before/after diffs in the real card. Inspect its disclosure and choices. This exact fixture also ships with issue 405; retain one definition when combining branches. Handlers do not execute tools.                                                                               |
| Empty/loading/error transitions | `Chat/Relevant Notes Pane/StateTransitions`                                 | Select **Next state** to move from loading to request error, no matches, and recovered results, then back to loading. This replaces props manually; no Miyo request is made. Existing `Loading`, `ChatRequestFailure`, `EmptyNoSemanticMatches` and `ConnectedScoredResults` remain individually available. |

The locked catalog failure came from missing required story props: the gallery merged `groups` without a `query`, then `ModelEnableList` called `query.trim()`. Production callers supply the query. A regression renders the actual merged meta/story args, without the unit helper's defaults, and checks locked versus available controls. No production fallback was added for invalid fixture data.

## Capture procedure

Use the running Obsidian gallery in default and installed-theme light/dark appearances. Sweep 300, 340, 400 and 600 px using gallery view state; stories do not pin widths. Collapse both workspace sidebars and confirm the actual leaf has room for the selected story width. Check that the story section and any portal are visible and not covered before treating clipping as a product defect.

For the transition fixture, capture all four states. For the model picker, open the actual menu and inspect keyboard focus. For permission diffs, retain the complete paths and changed content in the capture. Record host/theme/width and the state or menu action alongside screenshots.

Repeat affected settings and chat checks in their actual product hosts. Epic issues 404, 418 and 419 have separate native Settings evidence; the combined build must repeat that evidence after resolving their shared-file changes. Gallery settings geometry alone does not prove the settings journey or saved values.

## Remaining gaps

The current file inventory finds **124** presentational `.tsx` candidates under `ui/`, with **67** lacking an adjacent story file. This pass adds states to existing story modules, so that count remains unchanged. This is a file adjacency measure, not a count of fully tested components: some missing files render through composite stories, and an adjacent story can still omit important states.

Remaining behavioral gaps include the complete Settings navigation/save/reopen journey, real authentication and installation, live retrieval failures and retries, actual permission effects, arbitrary themes, popout ownership and combinations of these states. Automated audits and screenshots do not certify those paths. The bounded review set above intentionally does not add individual stories for all missing files.

### Files without adjacent stories at this snapshot

- `apps/obsidian/src/agentMode/skills/ui/AgentIconButton.tsx`
- `apps/obsidian/src/agentMode/skills/ui/DeleteConfirmDialog.tsx`
- `apps/obsidian/src/agentMode/skills/ui/EmptyPlaceholder.tsx`
- `apps/obsidian/src/agentMode/skills/ui/PropertiesDialog.tsx`
- `apps/obsidian/src/agentMode/skills/ui/SkillRow.tsx`
- `apps/obsidian/src/agentMode/skills/ui/SkillsSettings.tsx`
- `apps/obsidian/src/agentMode/ui/ActionCard.tsx`
- `apps/obsidian/src/agentMode/ui/AgentChatControls.tsx`
- `apps/obsidian/src/agentMode/ui/AgentChatInput.tsx`
- `apps/obsidian/src/agentMode/ui/AgentDefaultModelSetting.tsx`
- `apps/obsidian/src/agentMode/ui/AgentHome.tsx`
- `apps/obsidian/src/agentMode/ui/AgentHomeSection.tsx`
- `apps/obsidian/src/agentMode/ui/AgentHomeTab.tsx`
- `apps/obsidian/src/agentMode/ui/AgentMarkdownText.tsx`
- `apps/obsidian/src/agentMode/ui/AgentMessageActions.tsx`
- `apps/obsidian/src/agentMode/ui/AgentModeChat.tsx`
- `apps/obsidian/src/agentMode/ui/AgentModeStatus.tsx`
- `apps/obsidian/src/agentMode/ui/AgentProjectCreateForm.tsx`
- `apps/obsidian/src/agentMode/ui/AgentProjectRowActions.tsx`
- `apps/obsidian/src/agentMode/ui/AgentSelectPanel.tsx`
- `apps/obsidian/src/agentMode/ui/AgentTabStrip.tsx`
- `apps/obsidian/src/agentMode/ui/CopilotAgentView.tsx`
- `apps/obsidian/src/agentMode/ui/CreateProjectPanel.tsx`
- `apps/obsidian/src/agentMode/ui/PlanPreviewView.tsx`
- `apps/obsidian/src/agentMode/ui/PlanProposalCard.tsx`
- `apps/obsidian/src/agentMode/ui/ReportIssueModal.tsx`
- `apps/obsidian/src/agentMode/ui/SubAgentCard.tsx`
- `apps/obsidian/src/components/ui/CopilotBrandIcon.tsx`
- `apps/obsidian/src/components/ui/FreeModelWarningIcon.tsx`
- `apps/obsidian/src/components/ui/LicenseRequiredIcon.tsx`
- `apps/obsidian/src/components/ui/SearchBar.tsx`
- `apps/obsidian/src/components/ui/SelfHostCloudWarningIcon.tsx`
- `apps/obsidian/src/components/ui/card.tsx`
- `apps/obsidian/src/components/ui/checkbox.tsx`
- `apps/obsidian/src/components/ui/collapsible.tsx`
- `apps/obsidian/src/components/ui/dropdown-menu.tsx`
- `apps/obsidian/src/components/ui/form-field.tsx`
- `apps/obsidian/src/components/ui/help-tooltip.tsx`
- `apps/obsidian/src/components/ui/input.tsx`
- `apps/obsidian/src/components/ui/label.tsx`
- `apps/obsidian/src/components/ui/mobile-card.tsx`
- `apps/obsidian/src/components/ui/model-display.tsx`
- `apps/obsidian/src/components/ui/obsidian-native-select.tsx`
- `apps/obsidian/src/components/ui/password-input.tsx`
- `apps/obsidian/src/components/ui/popover.tsx`
- `apps/obsidian/src/components/ui/progress.tsx`
- `apps/obsidian/src/components/ui/resizable.tsx`
- `apps/obsidian/src/components/ui/scroll-area.tsx`
- `apps/obsidian/src/components/ui/segmented-control.tsx`
- `apps/obsidian/src/components/ui/separator.tsx`
- `apps/obsidian/src/components/ui/setting-item.tsx`
- `apps/obsidian/src/components/ui/setting-section.tsx`
- `apps/obsidian/src/components/ui/setting-slider.tsx`
- `apps/obsidian/src/components/ui/setting-switch.tsx`
- `apps/obsidian/src/components/ui/slider.tsx`
- `apps/obsidian/src/components/ui/table.tsx`
- `apps/obsidian/src/components/ui/textarea.tsx`
- `apps/obsidian/src/components/ui/tooltip.tsx`
- `apps/obsidian/src/components/ui/truncated-text.tsx`
- `apps/obsidian/src/modelManagement/ui/ModelManagementContext.tsx`
- `apps/obsidian/src/modelManagement/ui/components/ByokGlobalTable.tsx`
- `apps/obsidian/src/modelManagement/ui/dialogs/AddProviderDialog.tsx`
- `apps/obsidian/src/modelManagement/ui/dialogs/ConfigureProviderDialog.tsx`
- `apps/obsidian/src/modelManagement/ui/tabs/ByokPanel.tsx`
