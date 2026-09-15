# Gallery review coverage

This bounded pass supports [UI audit issue 427](https://github.com/Brevilabs/obsidian-copilot-private/issues/427). It does not certify real services or complete user journeys. Snapshot base: `20837e1973386ba374c80ac1d7bd12a966cd5432`.

## Representative review set

| Need | Story ID | Interaction and boundary |
| --- | --- | --- |
| Locked catalog | `Agent Mode/Model Enable List/LockedCopilotCatalog` | Copilot rows stay locked; BYOK rows remain visible. Complete meta args supply the required controlled query and handlers. This is a static catalog fixture, not model configuration. |
| Full native settings host | `Settings/Quick Chat models/Configured`, `Settings/Quick Chat models/Empty` | Existing composite section includes its heading, default selector and model list inside the gallery's `.modal.mod-settings` / `.vertical-tab-content` host. This tests section and host geometry; it is not the entire Copilot Settings page, settings navigation or persistence. |
| Open menu | `UI/Model Selector/Unlicensed` | Open the host popover, then open the model dropdown. Inspect long provider/model IDs, locked rows and lock explanations. Capture the open dropdown, not only its closed trigger. |
| Permission diffs | `Agent Mode/Tool Permission Card/MultipleFiles` | Two note paths and their before/after diffs in the real card. Inspect its disclosure and choices. This exact fixture also ships with issue 405; retain one definition when combining branches. Handlers do not execute tools. |
| Empty/loading/error transitions | `Chat/Relevant Notes Pane/StateTransitions` | Select **Next state** to move from loading to request error, no matches, and recovered results, then back to loading. This replaces props manually; no Miyo request is made. Existing `Loading`, `ChatRequestFailure`, `EmptyNoSemanticMatches` and `ConnectedScoredResults` remain individually available. |

The locked catalog failure came from missing required story props: the gallery merged `groups` without a `query`, then `ModelEnableList` called `query.trim()`. Production callers supply the query. A regression renders the actual merged meta/story args, without the unit helper's defaults, and checks locked versus available controls. No production fallback was added for invalid fixture data.

## Capture procedure

Use the running Obsidian gallery in default and installed-theme light/dark appearances. Sweep 300, 340, 400 and 600 px using gallery view state; stories do not pin widths. Collapse both workspace sidebars and confirm the actual leaf has room for the selected story width. Check that the story section and any portal are visible and not covered before treating clipping as a product defect.

For the transition fixture, capture all four states. For the model picker, open the actual menu and inspect keyboard focus. For permission diffs, retain the complete paths and changed content in the capture. Record host/theme/width and the state or menu action alongside screenshots.

Repeat affected settings and chat checks in their actual product hosts. Epic issues 404, 418 and 419 have separate native Settings evidence; the combined build must repeat that evidence after resolving their shared-file changes. Gallery settings geometry alone does not prove the settings journey or saved values.

## Remaining gaps

The current file inventory finds **124** presentational `.tsx` candidates under `ui/`, with **67** lacking an adjacent story file. This pass adds states to existing story modules, so that count remains unchanged. This is a file adjacency measure, not a count of fully tested components: some missing files render through composite stories, and an adjacent story can still omit important states.

Remaining behavioral gaps include the complete Settings navigation/save/reopen journey, real authentication and installation, live retrieval failures and retries, actual permission effects, arbitrary themes, popout ownership and combinations of these states. Automated audits and screenshots do not certify those paths. The bounded review set above intentionally does not add individual stories for all missing files.

### Files without adjacent stories at this snapshot

- `src/agentMode/skills/ui/AgentIconButton.tsx`
- `src/agentMode/skills/ui/DeleteConfirmDialog.tsx`
- `src/agentMode/skills/ui/EmptyPlaceholder.tsx`
- `src/agentMode/skills/ui/PropertiesDialog.tsx`
- `src/agentMode/skills/ui/SkillRow.tsx`
- `src/agentMode/skills/ui/SkillsSettings.tsx`
- `src/agentMode/ui/ActionCard.tsx`
- `src/agentMode/ui/AgentChatControls.tsx`
- `src/agentMode/ui/AgentChatInput.tsx`
- `src/agentMode/ui/AgentContextSection.tsx`
- `src/agentMode/ui/AgentContextStatusIcon.tsx`
- `src/agentMode/ui/AgentDefaultModelSetting.tsx`
- `src/agentMode/ui/AgentHome.tsx`
- `src/agentMode/ui/AgentHomeSection.tsx`
- `src/agentMode/ui/AgentHomeTab.tsx`
- `src/agentMode/ui/AgentMarkdownText.tsx`
- `src/agentMode/ui/AgentMessageActions.tsx`
- `src/agentMode/ui/AgentModeChat.tsx`
- `src/agentMode/ui/AgentModeStatus.tsx`
- `src/agentMode/ui/AgentProjectCreateForm.tsx`
- `src/agentMode/ui/AgentProjectRowActions.tsx`
- `src/agentMode/ui/AgentSelectPanel.tsx`
- `src/agentMode/ui/AgentTabStrip.tsx`
- `src/agentMode/ui/CopilotAgentView.tsx`
- `src/agentMode/ui/CreateProjectPanel.tsx`
- `src/agentMode/ui/FanoutMessageCard.tsx`
- `src/agentMode/ui/PlanPreviewView.tsx`
- `src/agentMode/ui/PlanProposalCard.tsx`
- `src/agentMode/ui/ReportIssueModal.tsx`
- `src/agentMode/ui/SubAgentCard.tsx`
- `src/components/ui/CopilotBrandIcon.tsx`
- `src/components/ui/FreeModelWarningIcon.tsx`
- `src/components/ui/LicenseRequiredIcon.tsx`
- `src/components/ui/SearchBar.tsx`
- `src/components/ui/SelfHostCloudWarningIcon.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/collapsible.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/form-field.tsx`
- `src/components/ui/help-tooltip.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/mobile-card.tsx`
- `src/components/ui/model-display.tsx`
- `src/components/ui/obsidian-native-select.tsx`
- `src/components/ui/password-input.tsx`
- `src/components/ui/popover.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/resizable.tsx`
- `src/components/ui/scroll-area.tsx`
- `src/components/ui/segmented-control.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/setting-item.tsx`
- `src/components/ui/setting-section.tsx`
- `src/components/ui/setting-slider.tsx`
- `src/components/ui/setting-switch.tsx`
- `src/components/ui/slider.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/ui/truncated-text.tsx`
- `src/modelManagement/ui/ModelManagementContext.tsx`
- `src/modelManagement/ui/components/ByokGlobalTable.tsx`
- `src/modelManagement/ui/dialogs/AddProviderDialog.tsx`
- `src/modelManagement/ui/dialogs/ConfigureProviderDialog.tsx`
- `src/modelManagement/ui/tabs/ByokPanel.tsx`
