# Scorecard warnings — community.obsidian.md/plugins/copilot

_Snapshot: 2026-05-12. Source: https://community.obsidian.md/plugins/copilot_

**908 issues found by automated scans of the latest release.**

Each section below is taken verbatim from the Obsidian community
scorecard. The intent is to hand these off to coding agents to fix.
Severity buckets: **Risks** (must fix), **Warnings** (should fix),
**Other** (informational), **Disclosures** (capability/permission notes).

Rule headings show the badge count from the scorecard. A handful of
rules have a few more reported occurrences than locations listed below
because the scorecard collapses identical `file:line` entries; the locations
shown here are the unique sites you'd actually edit.

## Risks (0)

## Warnings (906)

### Unexpected any. Specify a different type. (395)

<details><summary>395 locations</summary>

- `src/LLMProviders/BedrockChatModel.ts:130`
- `src/LLMProviders/BedrockChatModel.ts:132`
- `src/LLMProviders/BedrockChatModel.ts:148`
- `src/LLMProviders/BedrockChatModel.ts:148`
- `src/LLMProviders/BedrockChatModel.ts:151`
- `src/LLMProviders/BedrockChatModel.ts:155`
- `src/LLMProviders/BedrockChatModel.ts:400`
- `src/LLMProviders/BedrockChatModel.ts:416`
- `src/LLMProviders/BedrockChatModel.ts:457`
- `src/LLMProviders/BedrockChatModel.ts:485`
- `src/LLMProviders/BedrockChatModel.ts:948`
- `src/LLMProviders/BedrockChatModel.ts:1025`
- `src/LLMProviders/BedrockChatModel.ts:1026`
- `src/LLMProviders/BedrockChatModel.ts:1028`
- `src/LLMProviders/BedrockChatModel.ts:1029`
- `src/LLMProviders/BedrockChatModel.ts:1031`
- `src/LLMProviders/BedrockChatModel.ts:1032`
- `src/LLMProviders/BedrockChatModel.ts:1033`
- `src/LLMProviders/BedrockChatModel.ts:1077`
- `src/LLMProviders/BedrockChatModel.ts:1109`
- `src/LLMProviders/BedrockChatModel.ts:1429`
- `src/LLMProviders/BedrockChatModel.ts:1469`
- `src/LLMProviders/BedrockChatModel.ts:1500`
- `src/LLMProviders/BedrockChatModel.ts:1507`
- `src/LLMProviders/ChatLMStudio.ts:14`
- `src/LLMProviders/ChatLMStudio.ts:21`
- `src/LLMProviders/ChatOpenRouter.ts:47`
- `src/LLMProviders/ChatOpenRouter.ts:55`
- `src/LLMProviders/ChatOpenRouter.ts:104`
- `src/LLMProviders/ChatOpenRouter.ts:153`
- `src/LLMProviders/ChatOpenRouter.ts:155`
- `src/LLMProviders/ChatOpenRouter.ts:229`
- `src/LLMProviders/ChatOpenRouter.ts:279`
- `src/LLMProviders/ChatOpenRouter.ts:375`
- `src/LLMProviders/ChatOpenRouter.ts:423`
- `src/LLMProviders/CustomOpenAIEmbeddings.ts:4`
- `src/LLMProviders/CustomOpenAIEmbeddings.ts:6`
- `src/LLMProviders/CustomOpenAIEmbeddings.ts:60`
- `src/LLMProviders/brevilabsClient.ts:26`
- `src/LLMProviders/brevilabsClient.ts:27`
- `src/LLMProviders/brevilabsClient.ts:31`
- `src/LLMProviders/brevilabsClient.ts:36`
- `src/LLMProviders/brevilabsClient.ts:41`
- `src/LLMProviders/brevilabsClient.ts:67`
- `src/LLMProviders/brevilabsClient.ts:101`
- `src/LLMProviders/brevilabsClient.ts:197`
- `src/LLMProviders/brevilabsClient.ts:200`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:59`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:477`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:539`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:546`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:546`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:714`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:1084`
- `src/LLMProviders/chainRunner/BaseChainRunner.ts:113`
- `src/LLMProviders/chainRunner/BaseChainRunner.ts:124`
- `src/LLMProviders/chainRunner/BaseChainRunner.ts:149`
- `src/LLMProviders/chainRunner/BaseChainRunner.ts:203`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:71`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:72`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:116`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:125`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:251`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:549`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:549`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:573`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:587`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:742`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:785`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:796`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:841`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:889`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:923`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:946`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:949`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:950`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:953`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1001`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1006`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1025`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1026`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1073`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1074`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1104`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1111`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1147`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1149`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:1204`
- `src/LLMProviders/chainRunner/LLMChainRunner.ts:18`
- `src/LLMProviders/chainRunner/LLMChainRunner.ts:35`
- `src/LLMProviders/chainRunner/LLMChainRunner.ts:53`
- `src/LLMProviders/chainRunner/LLMChainRunner.ts:130`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts:142`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts:150`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts:156`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts:207`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts:249`
- `src/LLMProviders/chainRunner/utils/ActionBlockStreamer.ts:17`
- `src/LLMProviders/chainRunner/utils/ActionBlockStreamer.ts:35`
- `src/LLMProviders/chainRunner/utils/ActionBlockStreamer.ts:35`
- `src/LLMProviders/chainRunner/utils/ActionBlockStreamer.ts:82`
- `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts:123`
- `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts:160`
- `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts:203`
- `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts:236`
- `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts:256`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:9`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:19`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:52`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:72`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:73`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:90`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:96`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:97`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:232`
- `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:233`
- `src/LLMProviders/chainRunner/utils/finishReasonDetector.ts:31`
- `src/LLMProviders/chainRunner/utils/finishReasonDetector.ts:72`
- `src/LLMProviders/chainRunner/utils/modelAdapter.ts:78`
- `src/LLMProviders/chainRunner/utils/modelAdapter.ts:677`
- `src/LLMProviders/chainRunner/utils/modelAdapter.ts:677`
- `src/LLMProviders/chainRunner/utils/modelAdapter.ts:685`
- `src/LLMProviders/chainRunner/utils/promptPayloadRecorder.ts:88`
- `src/LLMProviders/chainRunner/utils/promptPayloadRecorder.ts:94`
- `src/LLMProviders/chainRunner/utils/promptPayloadRecorder.ts:95`
- `src/LLMProviders/chainRunner/utils/promptPayloadRecorder.ts:106`
- `src/LLMProviders/chainRunner/utils/promptPayloadRecorder.ts:197`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:23`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:80`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:94`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:99`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:100`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:101`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:162`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:163`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:168`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:196`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:285`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:286`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:295`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:296`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:320`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:321`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:405`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:423`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:438`
- `src/LLMProviders/chainRunner/utils/toolExecution.ts:33`
- `src/LLMProviders/chainRunner/utils/toolExecution.ts:216`
- `src/LLMProviders/chainRunner/utils/toolExecution.ts:286`
- `src/LLMProviders/chainRunner/utils/toolExecution.ts:287`
- `src/LLMProviders/chainRunner/utils/toolExecution.ts:290`
- `src/LLMProviders/chainRunner/utils/toolPromptDebugger.ts:9`
- `src/LLMProviders/chatModelManager.ts:51`
- `src/LLMProviders/chatModelManager.ts:57`
- `src/LLMProviders/chatModelManager.ts:62`
- `src/LLMProviders/chatModelManager.ts:62`
- `src/LLMProviders/chatModelManager.ts:490`
- `src/LLMProviders/chatModelManager.ts:583`
- `src/LLMProviders/chatModelManager.ts:814`
- `src/LLMProviders/chatModelManager.ts:888`
- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:34`
- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:35`
- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:180`
- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:181`
- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:184`
- `src/LLMProviders/memoryManager.ts:50`
- `src/LLMProviders/memoryManager.ts:61`
- `src/LLMProviders/memoryManager.ts:61`
- `src/aiParams.ts:131`
- `src/cache/fileCache.ts:11`
- `src/commands/CustomCommandSettingsModal.tsx:44`
- `src/commands/customCommandRegister.ts:109`
- `src/commands/customCommandRegister.ts:121`
- `src/commands/customCommandRegister.ts:135`
- `src/commands/index.ts:417`
- `src/commands/index.ts:425`
- `src/components/Chat.tsx:279`
- `src/components/chat-components/AtMentionTypeahead.tsx:15`
- `src/components/chat-components/AtMentionTypeahead.tsx:59`
- `src/components/chat-components/AtMentionTypeahead.tsx:186`
- `src/components/chat-components/ChatContextMenu.tsx:35`
- `src/components/chat-components/ChatContextMenu.tsx:38`
- `src/components/chat-components/ChatContextMenu.tsx:39`
- `src/components/chat-components/ChatContextMenu.tsx:47`
- `src/components/chat-components/ChatContextMenu.tsx:126`
- `src/components/chat-components/ChatControls.tsx:111`
- `src/components/chat-components/ChatControls.tsx:158`
- `src/components/chat-components/ChatInput.tsx:117`
- `src/components/chat-components/ChatInput.tsx:379`
- `src/components/chat-components/ChatInput.tsx:466`
- `src/components/chat-components/ChatInput.tsx:642`
- `src/components/chat-components/ChatSettingsPopover.tsx:131`
- `src/components/chat-components/ContextControl.tsx:19`
- `src/components/chat-components/ContextControl.tsx:22`
- `src/components/chat-components/ContextControl.tsx:23`
- `src/components/chat-components/ContextControl.tsx:42`
- `src/components/chat-components/ContextControl.tsx:47`
- `src/components/chat-components/LexicalEditor.tsx:62`
- `src/components/chat-components/ProjectList.tsx:168`
- `src/components/chat-components/TokenLimitWarning.tsx:33`
- `src/components/chat-components/TokenLimitWarning.tsx:33`
- `src/components/chat-components/pills/ActiveNotePillNode.tsx:166`
- `src/components/chat-components/pills/FolderPillNode.tsx:123`
- `src/components/chat-components/pills/NotePillNode.tsx:192`
- `src/components/chat-components/pills/ToolPillNode.tsx:78`
- `src/components/chat-components/pills/URLPillNode.tsx:189`
- `src/components/chat-components/plugins/ActiveNotePillSyncPlugin.tsx:38`
- `src/components/chat-components/plugins/AtMentionCommandPlugin.tsx:93`
- `src/components/chat-components/plugins/AtMentionCommandPlugin.tsx:129`
- `src/components/chat-components/plugins/AtMentionCommandPlugin.tsx:189`
- `src/components/chat-components/plugins/FocusPlugin.tsx:11`
- `src/components/chat-components/plugins/FolderPillSyncPlugin.tsx:20`
- `src/components/chat-components/plugins/GenericPillSyncPlugin.tsx:10`
- `src/components/chat-components/plugins/GenericPillSyncPlugin.tsx:12`
- `src/components/chat-components/plugins/GenericPillSyncPlugin.tsx:67`
- `src/components/chat-components/plugins/NotePillSyncPlugin.tsx:25`
- `src/components/chat-components/plugins/PillDeletionPlugin.tsx:22`
- `src/components/chat-components/plugins/PillDeletionPlugin.tsx:22`
- `src/components/chat-components/plugins/PillDeletionPlugin.tsx:29`
- `src/components/chat-components/plugins/PillDeletionPlugin.tsx:29`
- `src/components/chat-components/plugins/ToolPillSyncPlugin.tsx:20`
- `src/components/chat-components/plugins/URLPillSyncPlugin.tsx:20`
- `src/components/chat-components/utils/lexicalTextUtils.ts:652`
- `src/components/modals/SourcesModal.tsx:5`
- `src/components/modals/SourcesModal.tsx:9`
- `src/components/modals/SourcesModal.tsx:26`
- `src/components/modals/SourcesModal.tsx:64`
- `src/components/modals/SourcesModal.tsx:105`
- `src/components/modals/SourcesModal.tsx:118`
- `src/components/modals/SourcesModal.tsx:119`
- `src/components/modals/project/context-manage-modal.tsx:65`
- `src/components/modals/project/context-manage-modal.tsx:113`
- `src/components/ui/ModelParametersEditor.tsx:34`
- `src/context/ChatHistoryCompactor.ts:110`
- `src/context/ChatHistoryCompactor.ts:112`
- `src/contextProcessor.ts:83`
- `src/contextProcessor.ts:132`
- `src/contextProcessor.ts:156`
- `src/contextProcessor.ts:178`
- `src/contextProcessor.ts:188`
- `src/contextProcessor.ts:207`
- `src/contextProcessor.ts:222`
- `src/core/ChatManager.ts:419`
- `src/core/ChatPersistenceManager.ts:353`
- `src/core/ChatPersistenceManager.ts:426`
- `src/core/ChatPersistenceManager.ts:427`
- `src/core/MessageRepository.ts:37`
- `src/core/MessageRepository.ts:44`
- `src/encryptionService.ts:53`
- `src/errorFormat.ts:5`
- `src/errorFormat.ts:6`
- `src/errorFormat.ts:7`
- `src/errorFormat.ts:8`
- `src/hooks/useNoteDrag.ts:20`
- `src/lib/plugins/colorOpacityPlugin.ts:28`
- `src/lib/plugins/colorOpacityPlugin.ts:40`
- `src/lib/plugins/colorOpacityPlugin.ts:50`
- `src/lib/plugins/colorOpacityPlugin.ts:50`
- `src/lib/plugins/colorOpacityPlugin.ts:57`
- `src/lib/plugins/colorOpacityPlugin.ts:57`
- `src/lib/plugins/colorOpacityPlugin.ts:90`
- `src/logger.ts:4`
- `src/logger.ts:12`
- `src/logger.ts:20`
- `src/main.ts:890`
- `src/search/chunkedStorage.ts:13`
- `src/search/chunkedStorage.ts:56`
- `src/search/chunkedStorage.ts:58`
- `src/search/chunkedStorage.ts:59`
- `src/search/chunkedStorage.ts:107`
- `src/search/chunkedStorage.ts:126`
- `src/search/chunkedStorage.ts:160`
- `src/search/chunkedStorage.ts:170`
- `src/search/chunkedStorage.ts:182`
- `src/search/chunkedStorage.ts:184`
- `src/search/chunkedStorage.ts:227`
- `src/search/chunkedStorage.ts:285`
- `src/search/chunkedStorage.ts:292`
- `src/search/chunkedStorage.ts:292`
- `src/search/chunkedStorage.ts:311`
- `src/search/chunkedStorage.ts:311`
- `src/search/dbOperations.ts:31`
- `src/search/dbOperations.ts:35`
- `src/search/dbOperations.ts:81`
- `src/search/dbOperations.ts:206`
- `src/search/dbOperations.ts:264`
- `src/search/dbOperations.ts:295`
- `src/search/dbOperations.ts:300`
- `src/search/dbOperations.ts:302`
- `src/search/dbOperations.ts:306`
- `src/search/dbOperations.ts:323`
- `src/search/dbOperations.ts:337`
- `src/search/dbOperations.ts:365`
- `src/search/dbOperations.ts:365`
- `src/search/dbOperations.ts:435`
- `src/search/dbOperations.ts:526`
- `src/search/dbOperations.ts:526`
- `src/search/dbOperations.ts:671`
- `src/search/dbOperations.ts:676`
- `src/search/findRelevantNotes.ts:38`
- `src/search/findRelevantNotes.ts:105`
- `src/search/hybridRetriever.ts:165`
- `src/search/indexBackend/OramaIndexBackend.ts:200`
- `src/search/indexEventHandler.ts:75`
- `src/search/indexOperations.ts:321`
- `src/search/indexOperations.ts:324`
- `src/search/indexOperations.ts:487`
- `src/search/indexOperations.ts:502`
- `src/search/indexOperations.ts:506`
- `src/search/indexOperations.ts:549`
- `src/search/searchUtils.ts:345`
- `src/search/searchUtils.ts:346`
- `src/search/v3/MergedSemanticRetriever.ts:175`
- `src/search/v3/MergedSemanticRetriever.ts:208`
- `src/search/v3/MergedSemanticRetriever.ts:232`
- `src/search/v3/MergedSemanticRetriever.ts:241`
- `src/search/v3/QueryExpander.ts:126`
- `src/search/v3/QueryExpander.ts:192`
- `src/search/v3/TieredLexicalRetriever.ts:12`
- `src/search/v3/TieredLexicalRetriever.ts:139`
- `src/search/v3/TieredLexicalRetriever.ts:157`
- `src/search/v3/TieredLexicalRetriever.ts:157`
- `src/search/v3/utils/ScoreNormalizer.ts:33`
- `src/search/v3/utils/ScoreNormalizer.ts:36`
- `src/search/vectorStoreManager.ts:279`
- `src/settings/providerModels.ts:231`
- `src/settings/providerModels.ts:519`
- `src/settings/providerModels.ts:522`
- `src/settings/providerModels.ts:528`
- `src/settings/providerModels.ts:534`
- `src/settings/providerModels.ts:555`
- `src/settings/v2/components/AdvancedSettings.tsx:32`
- `src/settings/v2/components/ModelEditDialog.tsx:68`
- `src/settings/v2/components/ModelTable.tsx:400`
- `src/state/ChatUIState.ts:66`
- `src/tools/ComposerTools.ts:181`
- `src/tools/FileParserManager.ts:413`
- `src/tools/FileTreeTools.ts:12`
- `src/tools/FileTreeTools.ts:16`
- `src/tools/SearchTools.ts:212`
- `src/tools/SearchTools.ts:213`
- `src/tools/SearchTools.ts:239`
- `src/tools/SearchTools.ts:319`
- `src/tools/SearchTools.ts:320`
- `src/tools/SearchTools.ts:332`
- `src/tools/SearchTools.ts:436`
- `src/tools/SearchTools.ts:437`
- `src/tools/SearchTools.ts:526`
- `src/tools/ToolResultFormatter.ts:43`
- `src/tools/ToolResultFormatter.ts:138`
- `src/tools/ToolResultFormatter.ts:175`
- `src/tools/ToolResultFormatter.ts:200`
- `src/tools/ToolResultFormatter.ts:218`
- `src/tools/ToolResultFormatter.ts:254`
- `src/tools/ToolResultFormatter.ts:254`
- `src/tools/ToolResultFormatter.ts:257`
- `src/tools/ToolResultFormatter.ts:257`
- `src/tools/ToolResultFormatter.ts:258`
- `src/tools/ToolResultFormatter.ts:277`
- `src/tools/ToolResultFormatter.ts:318`
- `src/tools/ToolResultFormatter.ts:344`
- `src/tools/ToolResultFormatter.ts:421`
- `src/tools/ToolResultFormatter.ts:423`
- `src/tools/ToolResultFormatter.ts:539`
- `src/tools/ToolResultFormatter.ts:554`
- `src/tools/ToolResultFormatter.ts:570`
- `src/tools/ToolResultFormatter.ts:571`
- `src/tools/memoryTools.ts:40`
- `src/tools/toolManager.ts:23`
- `src/tools/toolManager.ts:23`
- `src/tools/toolManager.ts:23`
- `src/types/message.ts:147`
- `src/types/message.ts:150`
- `src/types/message.ts:215`
- `src/types/message.ts:216`
- `src/utils.ts:50`
- `src/utils.ts:68`
- `src/utils.ts:77`
- `src/utils.ts:87`
- `src/utils.ts:643`
- `src/utils.ts:675`
- `src/utils.ts:940`
- `src/utils.ts:1114`
- `src/utils.ts:1169`
- `src/utils.ts:1169`
- `src/utils.ts:1179`
- `src/utils.ts:1179`
- `src/utils.ts:1195`
- `src/utils.ts:1195`
- `src/utils.ts:1292`
- `src/utils.ts:1313`
- `src/utils.ts:1330`
- `src/utils.ts:1518`
- `src/utils/rateLimitUtils.ts:14`
- `src/utils/rateLimitUtils.ts:31`

</details>

### Unexpected use of 'app'. Avoid using the global app object. Instead use the reference provided by your plugin instance. (166)

<details><summary>166 locations</summary>

- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:398`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:435`
- `src/cache/fileCache.ts:27`
- `src/cache/fileCache.ts:29`
- `src/cache/fileCache.ts:53`
- `src/cache/fileCache.ts:55`
- `src/cache/fileCache.ts:123`
- `src/cache/fileCache.ts:137`
- `src/cache/fileCache.ts:138`
- `src/cache/fileCache.ts:152`
- `src/cache/fileCache.ts:153`
- `src/cache/fileCache.ts:157`
- `src/cache/pdfCache.ts:20`
- `src/cache/pdfCache.ts:22`
- `src/cache/pdfCache.ts:43`
- `src/cache/pdfCache.ts:45`
- `src/cache/pdfCache.ts:62`
- `src/cache/pdfCache.ts:70`
- `src/cache/pdfCache.ts:71`
- `src/cache/pdfCache.ts:74`
- `src/cache/projectContextCache.ts:46`
- `src/commands/CustomCommandChatModal.tsx:146`
- `src/commands/customCommandManager.ts:59`
- `src/commands/customCommandManager.ts:61`
- `src/commands/customCommandManager.ts:63`
- `src/commands/customCommandManager.ts:66`
- `src/commands/customCommandManager.ts:99`
- `src/commands/customCommandManager.ts:102`
- `src/commands/customCommandManager.ts:108`
- `src/commands/customCommandManager.ts:110`
- `src/commands/customCommandManager.ts:112`
- `src/commands/customCommandManager.ts:121`
- `src/commands/customCommandManager.ts:125`
- `src/commands/customCommandManager.ts:126`
- `src/commands/customCommandManager.ts:164`
- `src/commands/customCommandManager.ts:166`
- `src/commands/customCommandUtils.ts:102`
- `src/commands/customCommandUtils.ts:110`
- `src/commands/customCommandUtils.ts:112`
- `src/commands/customCommandUtils.ts:134`
- `src/commands/customCommandUtils.ts:195`
- `src/commands/customCommandUtils.ts:196`
- `src/commands/customCommandUtils.ts:496`
- `src/commands/migrator.ts:25`
- `src/commands/migrator.ts:26`
- `src/commands/migrator.ts:86`
- `src/commands/migrator.ts:109`
- `src/components/chat-components/ChatSettingsPopover.tsx:202`
- `src/components/chat-components/ProjectList.tsx:132`
- `src/components/chat-components/RelevantNotes.tsx:115`
- `src/components/chat-components/RelevantNotes.tsx:117`
- `src/components/chat-components/RelevantNotes.tsx:164`
- `src/components/chat-components/RelevantNotes.tsx:283`
- `src/components/chat-components/RelevantNotes.tsx:285`
- `src/components/chat-components/RelevantNotes.tsx:308`
- `src/components/chat-components/RelevantNotes.tsx:395`
- `src/components/chat-components/hooks/useOpenWebTabs.ts:31`
- `src/components/chat-components/hooks/useOpenWebTabs.ts:158`
- `src/components/chat-components/hooks/useOpenWebTabs.ts:162`
- `src/components/chat-components/hooks/useOpenWebTabs.ts:163`
- `src/components/chat-components/hooks/useOpenWebTabs.ts:175`
- `src/components/chat-components/hooks/useOpenWebTabs.ts:176`
- `src/components/modals/TagSearchModal.tsx:14`
- `src/contextProcessor.ts:83`
- `src/contextProcessor.ts:324`
- `src/contextProcessor.ts:428`
- `src/contextProcessor.ts:797`
- `src/hooks/useActiveFile.ts:12`
- `src/hooks/useNoteDrag.ts:20`
- `src/hooks/useNoteDrag.ts:26`
- `src/logFileManager.ts:44`
- `src/logFileManager.ts:44`
- `src/logFileManager.ts:130`
- `src/logFileManager.ts:132`
- `src/logFileManager.ts:146`
- `src/logFileManager.ts:148`
- `src/logFileManager.ts:233`
- `src/logFileManager.ts:235`
- `src/logFileManager.ts:237`
- `src/logFileManager.ts:244`
- `src/logFileManager.ts:247`
- `src/mentions/Mention.ts:109`
- `src/noteUtils.ts:12`
- `src/noteUtils.ts:18`
- `src/noteUtils.ts:31`
- `src/noteUtils.ts:54`
- `src/noteUtils.ts:59`
- `src/search/findRelevantNotes.ts:132`
- `src/search/findRelevantNotes.ts:133`
- `src/search/findRelevantNotes.ts:141`
- `src/search/findRelevantNotes.ts:292`
- `src/search/findRelevantNotes.ts:314`
- `src/search/hybridRetriever.ts:34`
- `src/search/hybridRetriever.ts:223`
- `src/search/searchUtils.ts:244`
- `src/search/searchUtils.ts:313`
- `src/settings/v2/components/AdvancedSettings.tsx:32`
- `src/settings/v2/components/AdvancedSettings.tsx:33`
- `src/settings/v2/components/AdvancedSettings.tsx:37`
- `src/settings/v2/components/QASettings.tsx:24`
- `src/settings/v2/components/QASettings.tsx:56`
- `src/state/vaultDataAtoms.ts:74`
- `src/state/vaultDataAtoms.ts:88`
- `src/state/vaultDataAtoms.ts:89`
- `src/state/vaultDataAtoms.ts:90`
- `src/state/vaultDataAtoms.ts:91`
- `src/state/vaultDataAtoms.ts:92`
- `src/state/vaultDataAtoms.ts:204`
- `src/state/vaultDataAtoms.ts:206`
- `src/state/vaultDataAtoms.ts:221`
- `src/state/vaultDataAtoms.ts:223`
- `src/state/vaultDataAtoms.ts:235`
- `src/state/vaultDataAtoms.ts:235`
- `src/state/vaultDataAtoms.ts:239`
- `src/state/vaultDataAtoms.ts:257`
- `src/state/vaultDataAtoms.ts:257`
- `src/state/vaultDataAtoms.ts:261`
- `src/state/vaultDataAtoms.ts:293`
- `src/state/vaultDataAtoms.ts:294`
- `src/state/vaultDataAtoms.ts:295`
- `src/state/vaultDataAtoms.ts:296`
- `src/state/vaultDataAtoms.ts:297`
- `src/state/vaultDataAtoms.ts:299`
- `src/state/vaultDataAtoms.ts:300`
- `src/system-prompts/systemPromptManager.ts:139`
- `src/system-prompts/systemPromptManager.ts:150`
- `src/system-prompts/systemPromptUtils.ts:121`
- `src/system-prompts/systemPromptUtils.ts:123`
- `src/system-prompts/systemPromptUtils.ts:153`
- `src/system-prompts/systemPromptUtils.ts:188`
- `src/system-prompts/systemPromptUtils.ts:211`
- `src/system-prompts/systemPromptUtils.ts:221`
- `src/system-prompts/systemPromptUtils.ts:263`
- `src/system-prompts/systemPromptUtils.ts:275`
- `src/tools/ComposerTools.ts:12`
- `src/tools/ComposerTools.ts:29`
- `src/tools/ComposerTools.ts:34`
- `src/tools/ComposerTools.ts:56`
- `src/tools/ComposerTools.ts:60`
- `src/tools/ComposerTools.ts:65`
- `src/tools/ComposerTools.ts:73`
- `src/tools/ComposerTools.ts:175`
- `src/tools/ComposerTools.ts:528`
- `src/tools/ComposerTools.ts:538`
- `src/tools/ComposerTools.ts:566`
- `src/tools/NoteTools.ts:103`
- `src/tools/NoteTools.ts:137`
- `src/tools/NoteTools.ts:161`
- `src/tools/NoteTools.ts:220`
- `src/tools/NoteTools.ts:229`
- `src/tools/NoteTools.ts:253`
- `src/tools/TagTools.ts:55`
- `src/tools/TagTools.ts:55`
- `src/tools/TagTools.ts:58`
- `src/utils.ts:200`
- `src/utils.ts:348`
- `src/utils.ts:358`
- `src/utils.ts:1031`
- `src/utils.ts:1038`
- `src/utils.ts:1411`
- `src/utils.ts:1512`
- `src/utils.ts:1527`
- `src/utils.ts:1530`
- `src/utils/chatHistoryUtils.ts:11`
- `src/utils/chatHistoryUtils.ts:36`
- `src/utils/chatHistoryUtils.ts:52`

</details>

### Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator. (67)

<details><summary>67 locations</summary>

- `src/LLMProviders/chainManager.ts:63`
- `src/LLMProviders/chainManager.ts:105`
- `src/LLMProviders/chainManager.ts:176`
- `src/LLMProviders/chainManager.ts:362`
- `src/commands/CustomCommandChatModal.tsx:332`
- `src/commands/CustomCommandChatModal.tsx:681`
- `src/commands/customCommandManager.ts:83`
- `src/commands/customCommandRegister.ts:36`
- `src/commands/customCommandRegister.ts:144`
- `src/commands/index.ts:112`
- `src/commands/index.ts:117`
- `src/commands/index.ts:300`
- `src/commands/index.ts:549`
- `src/commands/index.ts:595`
- `src/commands/migrator.ts:96`
- `src/commands/migrator.ts:111`
- `src/components/Chat.tsx:350`
- `src/components/Chat.tsx:368`
- `src/components/Chat.tsx:453`
- `src/components/Chat.tsx:530`
- `src/components/chat-components/ChatContextMenu.tsx:142`
- `src/components/chat-components/ChatControls.tsx:255`
- `src/components/chat-components/ChatControls.tsx:262`
- `src/components/chat-components/ChatControls.tsx:270`
- `src/components/chat-components/ChatControls.tsx:294`
- `src/components/chat-components/ChatSettingsPopover.tsx:202`
- `src/components/chat-components/ChatSingleMessage.tsx:348-354`
- `src/components/chat-components/ChatSingleMessage.tsx:698`
- `src/components/chat-components/ChatSingleMessage.tsx:893`
- `src/components/chat-components/RelevantNotes.tsx:52`
- `src/components/chat-components/RelevantNotes.tsx:87`
- `src/components/chat-components/RelevantNotes.tsx:135`
- `src/components/chat-components/RelevantNotes.tsx:286`
- `src/components/chat-components/plugins/AtMentionCommandPlugin.tsx:160`
- `src/components/chat-components/plugins/NoteCommandPlugin.tsx:105`
- `src/components/chat-components/plugins/NoteCommandPlugin.tsx:113`
- `src/components/chat-components/plugins/PastePlugin.tsx:40-50`
- `src/components/chat-components/plugins/SlashCommandPlugin.tsx:70`
- `src/components/modals/ApplyCustomCommandModal.tsx:57`
- `src/components/modals/SourcesModal.tsx:75`
- `src/components/modals/YoutubeTranscriptModal.tsx:128`
- `src/components/modals/project/context-manage-modal.tsx:421`
- `src/components/ui/password-input.tsx:44`
- `src/core/ChatManager.ts:691`
- `src/hooks/useChatManager.ts:113`
- `src/hooks/useLatestVersion.ts:19`
- `src/main.ts:115`
- `src/main.ts:116`
- `src/main.ts:168`
- `src/main.ts:209`
- `src/main.ts:212-214`
- `src/main.ts:323`
- `src/main.ts:550`
- `src/main.ts:556`
- `src/main.ts:558`
- `src/main.ts:749`
- `src/search/dbOperations.ts:223`
- `src/search/indexEventHandler.ts:137`
- `src/search/indexOperations.ts:475`
- `src/settings/v2/components/AdvancedSettings.tsx:33`
- `src/settings/v2/components/CommandSettings.tsx:418`
- `src/settings/v2/components/GitHubCopilotAuth.tsx:273`
- `src/settings/v2/components/LocalServicesSection.tsx:88`
- `src/settings/v2/components/ModelImporter.tsx:121`
- `src/settings/v2/components/ModelImporter.tsx:209`
- `src/state/ChatUIState.ts:218`
- `src/tools/ComposerTools.ts:74-85`

</details>

### Use 'activeDocument' instead of 'document' for popout window compatibility. (11)

- `src/components/quick-ask/QuickAskOverlay.tsx:313`
- `src/components/quick-ask/QuickAskOverlay.tsx:324`
- `src/components/quick-ask/QuickAskOverlay.tsx:328`
- `src/components/quick-ask/QuickAskOverlay.tsx:383`
- `src/components/quick-ask/QuickAskOverlay.tsx:531`
- `src/components/quick-ask/QuickAskOverlay.tsx:664`
- `src/components/quick-ask/QuickAskOverlay.tsx:720`
- `src/components/quick-ask/QuickAskOverlay.tsx:739`
- `src/components/quick-ask/QuickAskOverlay.tsx:855`
- `src/main.ts:368`
- `src/main.ts:379`

### Promise-returning function provided to attribute where a void return was expected. (54)

<details><summary>54 locations</summary>

- `src/commands/CustomCommandChatModal.tsx:452`
- `src/commands/CustomCommandChatModal.tsx:456`
- `src/components/Chat.tsx:852`
- `src/components/Chat.tsx:853`
- `src/components/Chat.tsx:854`
- `src/components/Chat.tsx:884`
- `src/components/Chat.tsx:885`
- `src/components/Chat.tsx:886`
- `src/components/Chat.tsx:892`
- `src/components/Chat.tsx:894`
- `src/components/Chat.tsx:912`
- `src/components/chat-components/ChatControls.tsx:330`
- `src/components/chat-components/ChatControls.tsx:404`
- `src/components/chat-components/ChatControls.tsx:411`
- `src/components/chat-components/ChatControls.tsx:421`
- `src/components/chat-components/ChatHistoryPopover.tsx:301`
- `src/components/chat-components/ChatHistoryPopover.tsx:303`
- `src/components/chat-components/ChatHistoryPopover.tsx:305`
- `src/components/chat-components/ChatHistoryPopover.tsx:306`
- `src/components/chat-components/RelevantNotes.tsx:350`
- `src/components/chat-components/RelevantNotes.tsx:357`
- `src/components/composer/ApplyView.tsx:557`
- `src/components/composer/ApplyView.tsx:561`
- `src/components/modals/YoutubeTranscriptModal.tsx:159`
- `src/components/modals/YoutubeTranscriptModal.tsx:162`
- `src/components/modals/YoutubeTranscriptModal.tsx:193`
- `src/components/modals/project/AddProjectModal.tsx:376`
- `src/components/project/progress-card.tsx:215-218`
- `src/components/quick-ask/QuickAskPanel.tsx:321`
- `src/components/quick-ask/QuickAskPanel.tsx:343`
- `src/components/quick-ask/QuickAskPanel.tsx:409`
- `src/components/ui/ModelSelector.tsx:72-92`
- `src/settings/v2/SettingsMainV2.tsx:126`
- `src/settings/v2/components/AdvancedSettings.tsx:126-130`
- `src/settings/v2/components/CommandSettings.tsx:370`
- `src/settings/v2/components/CommandSettings.tsx:386`
- `src/settings/v2/components/CommandSettings.tsx:387`
- `src/settings/v2/components/CommandSettings.tsx:388`
- `src/settings/v2/components/CommandSettings.tsx:498`
- `src/settings/v2/components/CommandSettings.tsx:551`
- `src/settings/v2/components/CommandSettings.tsx:552`
- `src/settings/v2/components/CommandSettings.tsx:553`
- `src/settings/v2/components/CopilotPlusSettings.tsx:216`
- `src/settings/v2/components/CopilotPlusSettings.tsx:235`
- `src/settings/v2/components/GitHubCopilotAuth.tsx:331`
- `src/settings/v2/components/GitHubCopilotAuth.tsx:348`
- `src/settings/v2/components/GitHubCopilotAuth.tsx:376`
- `src/settings/v2/components/LocalServicesSection.tsx:211`
- `src/settings/v2/components/ModelAddDialog.tsx:736`
- `src/settings/v2/components/ModelAddDialog.tsx:760`
- `src/settings/v2/components/ModelImporter.tsx:219`
- `src/settings/v2/components/PlusSettings.tsx:57-68`
- `src/settings/v2/components/QASettings.tsx:120`
- `src/system-prompts/SystemPromptAddModal.tsx:268`

</details>

### The two values in this comparison do not have a shared enum type. (48)

<details><summary>48 locations</summary>

- `src/LLMProviders/chatModelManager.ts:438`
- `src/LLMProviders/chatModelManager.ts:508`
- `src/LLMProviders/chatModelManager.ts:663`
- `src/LLMProviders/chatModelManager.ts:782`
- `src/LLMProviders/chatModelManager.ts:783`
- `src/LLMProviders/chatModelManager.ts:802`
- `src/LLMProviders/chatModelManager.ts:817`
- `src/LLMProviders/chatModelManager.ts:818`
- `src/LLMProviders/chatModelManager.ts:826`
- `src/LLMProviders/chatModelManager.ts:895`
- `src/LLMProviders/chatModelManager.ts:896`
- `src/LLMProviders/chatModelManager.ts:904`
- `src/LLMProviders/projectManager.ts:67`
- `src/components/ui/ModelParametersEditor.tsx:50`
- `src/components/ui/ModelParametersEditor.tsx:69`
- `src/components/ui/ModelParametersEditor.tsx:77`
- `src/components/ui/ModelParametersEditor.tsx:79`
- `src/components/ui/ModelParametersEditor.tsx:81`
- `src/hooks/use-streaming-chat-session.ts:97`
- `src/hooks/use-streaming-chat-session.ts:97`
- `src/plusUtils.ts:89`
- `src/settings/v2/components/ModelAddDialog.tsx:76`
- `src/settings/v2/components/ModelAddDialog.tsx:122`
- `src/settings/v2/components/ModelAddDialog.tsx:141`
- `src/settings/v2/components/ModelAddDialog.tsx:499`
- `src/settings/v2/components/ModelAddDialog.tsx:538`
- `src/settings/v2/components/ModelAddDialog.tsx:546`
- `src/settings/v2/components/ModelAddDialog.tsx:704`
- `src/settings/v2/components/ModelAddDialog.tsx:705`
- `src/settings/v2/components/ModelEditDialog.tsx:47`
- `src/settings/v2/components/ModelEditDialog.tsx:123`
- `src/settings/v2/components/ModelEditDialog.tsx:211`
- `src/settings/v2/components/ModelEditDialog.tsx:274`
- `src/settings/v2/components/ModelEditDialog.tsx:275`
- `src/settings/v2/components/ModelEditDialog.tsx:300`
- `src/settings/v2/utils/modelActions.ts:126`
- `src/settings/v2/utils/modelActions.ts:159`
- `src/utils.ts:1240`
- `src/utils.ts:1255`
- `src/utils.ts:1269`
- `src/utils/curlCommand.ts:254`
- `src/utils/curlCommand.ts:743`
- `src/utils/curlCommand.ts:750`
- `src/utils/curlCommand.ts:760`
- `src/utils/curlCommand.ts:772`
- `src/utils/curlCommand.ts:772`
- `src/utils/curlCommand.ts:779`
- `src/utils/curlCommand.ts:779`

</details>

### This assertion is unnecessary since it does not change the type of the expression. (44)

<details><summary>44 locations</summary>

- `src/LLMProviders/BedrockChatModel.ts:1025`
- `src/LLMProviders/BedrockChatModel.ts:1026`
- `src/LLMProviders/BedrockChatModel.ts:1028`
- `src/LLMProviders/BedrockChatModel.ts:1029`
- `src/LLMProviders/BedrockChatModel.ts:1031`
- `src/LLMProviders/BedrockChatModel.ts:1032`
- `src/LLMProviders/ChatOpenRouter.ts:172`
- `src/LLMProviders/chainManager.ts:203-208`
- `src/LLMProviders/chainManager.ts:257-262`
- `src/LLMProviders/chainManager.ts:271-276`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:546`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts:546`
- `src/LLMProviders/chainRunner/BaseChainRunner.ts:209`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:163-165`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:99`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:100`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:101`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:296`
- `src/LLMProviders/chainRunner/utils/searchResultUtils.ts:321`
- `src/components/CopilotView.tsx:97`
- `src/components/CopilotView.tsx:141`
- `src/components/chat-components/ChatSingleMessage.tsx:648`
- `src/components/chat-components/ChatSingleMessage.tsx:724`
- `src/components/chat-components/ChatSingleMessage.tsx:758`
- `src/components/chat-components/ChatViewLayout.ts:52`
- `src/components/chat-components/ChatViewLayout.ts:53`
- `src/components/chat-components/InlineMessageEditor.tsx:35`
- `src/components/chat-components/utils/lexicalTextUtils.ts:77`
- `src/components/modals/project/AddProjectModal.tsx:150`
- `src/context/PromptContextEngine.ts:51`
- `src/contextProcessor.ts:104`
- `src/lib/plugins/colorOpacityPlugin.ts:94`
- `src/miyo/MiyoClient.ts:439`
- `src/search/chunkedStorage.ts:292`
- `src/search/chunkedStorage.ts:311`
- `src/search/v3/engines/FullTextEngine.ts:295`
- `src/search/v3/scoring/GraphBoostCalculator.ts:161`
- `src/services/webViewerService/webViewerServiceHelpers.ts:279`
- `src/settings/model.ts:450`
- `src/tools/ComposerTools.ts:60`
- `src/tools/ComposerTools.ts:65`
- `src/tools/ToolResultFormatter.ts:257`
- `src/tools/ToolResultFormatter.ts:257`
- `src/tools/ToolResultFormatter.ts:258`

</details>

### Use 'window.setTimeout()' instead of 'setTimeout()' for popout window compatibility. (5)

- `src/components/chat-components/ChatContextMenu.tsx:131`
- `src/components/chat-components/ProjectList.tsx:291`
- `src/main.ts:311`
- `src/main.ts:580`
- `src/main.ts:809`

### Promise returned in function argument where a void return was expected. (39)

<details><summary>39 locations</summary>

- `src/LLMProviders/chainManager.ts:65-67`
- `src/LLMProviders/projectManager.ts:55-57`
- `src/LLMProviders/projectManager.ts:59-73`
- `src/LLMProviders/projectManager.ts:76-78`
- `src/LLMProviders/projectManager.ts:85-111`
- `src/commands/index.ts:85-92`
- `src/commands/index.ts:94-105`
- `src/commands/index.ts:181-213`
- `src/commands/index.ts:215-231`
- `src/commands/index.ts:235-259`
- `src/commands/index.ts:261-297`
- `src/commands/index.ts:303-396`
- `src/commands/index.ts:398-467`
- `src/commands/index.ts:470-486`
- `src/commands/index.ts:489-497`
- `src/commands/index.ts:500-508`
- `src/commands/index.ts:511-550`
- `src/commands/index.ts:553-600`
- `src/commands/index.ts:603-615`
- `src/commands/index.ts:610-612`
- `src/commands/index.ts:624-633`
- `src/components/chat-components/ChatControls.tsx:140-178`
- `src/components/chat-components/ChatControls.tsx:431`
- `src/components/chat-components/RelevantNotes.tsx:309-316`
- `src/components/modals/project/AddProjectModal.tsx:79-81`
- `src/hooks/useChatFileDrop.ts:247`
- `src/hooks/useChatFileDrop.ts:253`
- `src/main.ts:97-104`
- `src/search/dbOperations.ts:47-69`
- `src/search/indexOperations.ts:53-55`
- `src/services/webViewerService/webViewerServiceSelection.ts:145-149`
- `src/settings/v2/SettingsMainV2.tsx:90-94`
- `src/settings/v2/components/CommandSettings.tsx:61-63`
- `src/settings/v2/components/CommandSettings.tsx:248-250`
- `src/settings/v2/components/CommandSettings.tsx:461`
- `src/settings/v2/components/CommandSettings.tsx:481-483`
- `src/settings/v2/components/CopilotPlusSettings.tsx:88`
- `src/settings/v2/components/QASettings.tsx:24-30`
- `src/settings/v2/components/QASettings.tsx:57-69`

</details>

### Use 'window.clearTimeout()' instead of 'clearTimeout()' for popout window compatibility. (1)

- `src/main.ts:801`

### Unexpected `await` of a non-Promise (non-"Thenable") value. (13)

- `src/commands/customCommandUtils.ts:298`
- `src/commands/customCommandUtils.ts:312`
- `src/commands/index.ts:86`
- `src/core/ContextManager.ts:676`
- `src/main.ts:302`
- `src/search/chunkedStorage.ts:109`
- `src/search/chunkedStorage.ts:237-245`
- `src/search/chunkedStorage.ts:246`
- `src/search/chunkedStorage.ts:252-260`
- `src/search/chunkedStorage.ts:321`
- `src/search/dbOperations.ts:278-286`
- `src/settings/v2/components/CommandSettings.tsx:62`
- `src/settings/v2/components/CommandSettings.tsx:249`

### Avoid casting to 'TFile'. Use an 'instanceof TFile' check to safely narrow the type. (5)

- `src/tools/ComposerTools.ts:60`
- `src/tools/ComposerTools.ts:65`
- `src/utils/vaultAdapterUtils.ts:9`
- `src/utils/vaultAdapterUtils.ts:59`
- `src/utils/vaultAdapterUtils.ts:133`

### "crypto-js" should be replaced with an alternative package. (7)

- `package.json:124`
- `src/cache/fileCache.ts:2`
- `src/cache/pdfCache.ts:3`
- `src/cache/projectContextCache.ts:6`
- `src/context/PromptContextEngine.ts:1`
- `src/search/dbOperations.ts:11`
- `src/search/indexOperations.ts:15`

### "lodash.debounce" should be replaced with an alternative package. (6)

- `package.json:134`
- `src/cache/projectContextCache.ts:8`
- `src/commands/customCommandRegister.ts:12`
- `src/components/chat-components/ChatSettingsPopover.tsx:14`
- `src/state/vaultDataAtoms.ts:3`
- `src/system-prompts/systemPromptRegister.ts:20`

### The case statement does not have a shared enum type with the switch predicate. (6)

- `src/commands/customCommandUtils.ts:171-172`
- `src/commands/customCommandUtils.ts:173-174`
- `src/commands/customCommandUtils.ts:175-176`
- `src/settings/v2/components/ModelAddDialog.tsx:328-341`
- `src/settings/v2/components/ModelAddDialog.tsx:342-422`
- `src/settings/v2/components/ModelAddDialog.tsx:423-465`

### 'any' overrides all other types in this union type. (4)

- `src/LLMProviders/BedrockChatModel.ts:400`
- `src/search/dbOperations.ts:365`
- `src/search/v3/utils/ScoreNormalizer.ts:33`
- `src/search/v3/utils/ScoreNormalizer.ts:36`

### `system_fingerprint` is deprecated. This fingerprint represents the backend configuration that the model

runs with. Can be used in conjunction with the `seed` request parameter to
understand when backend changes have been made that might impact determinism. (3)

- `src/LLMProviders/ChatOpenRouter.ts:203`
- `src/LLMProviders/ChatOpenRouter.ts:463`
- `src/LLMProviders/ChatOpenRouter.ts:464`

### Invalid type "never" of template literal expression. (2)

- `src/LLMProviders/chainManager.ts:305`
- `src/LLMProviders/projectManager.ts:893`

### 'error' will use Object's default stringification format ('[object Object]') when stringified. (2)

- `src/core/ChatPersistenceManager.ts:792`
- `src/core/ChatPersistenceManager.ts:804`

### A method that is not declared with `this: void` may cause unintentional scoping of `this` when separated from its object.

Consider using an arrow function or explicitly `.bind()`ing the method to avoid calling the method with an unintended `this` value.
If a function does not access `this`, it can be annotated with `this: void`. (2)

- `src/lib/plugins/colorOpacityPlugin.ts:89`
- `src/services/webViewerService/webViewerServiceTypes.ts:183`

### Promise-returning method provided where a void return was expected by extended/implemented type 'Plugin_2'. (2)

- `src/main.ts:95-222`
- `src/main.ts:224-260`

### Manifest is missing optional but recommended field: `isDesktopOnly`

### `main.js` from release `3.2.8` is larger than 5 MB. Users with the Obsidian Sync Standard plan will not be able to sync this file.

### Plugin combines `setInterval` with network calls. May perform periodic background data transmission.

### "builtin-modules" should be replaced with an alternative package.

- `package.json:55`

### "eslint-plugin-react" should be replaced with an alternative package.

- `package.json:60`

### "lint-staged" should be replaced with an alternative package.

- `package.json:66`

### "node-fetch" should be replaced with an alternative package.

- `package.json:67`

### "npm-run-all" should be replaced with an alternative package.

- `package.json:68`

### "axios" should be replaced with an alternative package.

- `package.json:117`

### 'response.content' will use Object's default stringification format ('[object Object]') when stringified.

- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:183`

### 'embeddingsInstance' will use Object's default stringification format ('[object Object]') when stringified.

- `src/LLMProviders/embeddingManager.ts:127`

### Invalid type "Embeddings<number[]>" of template literal expression.

- `src/LLMProviders/embeddingManager.ts:127`

### Do not access Object.prototype method 'hasOwnProperty' from target object.

- `src/LLMProviders/embeddingManager.ts:144`

### 'input' may use Object's default stringification format ('[object Object]') when stringified.

- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:97`

### `_convertCompletionsDeltaToBaseMessageChunk` is deprecated. This function was hoisted into a publicly accessible function from a

different export, but to maintain backwards compatibility with chat models
that depend on ChatOpenAICompletions, we'll keep it here as an overridable
method. This will be removed in a future release

- `src/LLMProviders/githubCopilot/GitHubCopilotChatModel.ts:201`

### Avoid setting styles directly via `element.style.setProperty`. Use CSS classes for better theming and maintainability. Use the `setCssProps` function if the CSS properties need to change dynamically.

- `src/components/chat-components/ChatViewLayout.ts:57`

### Unexpected iterable of non-Promise (non-"Thenable") values passed to promise aggregator.

- `src/components/chat-components/plugins/PastePlugin.tsx:41-44`

### `extractSource` is deprecated. Use extractSourceFromBlock from contextBlockRegistry instead

- `src/context/L2ContextCompactor.ts:123`

### Invalid type "unknown" of template literal expression.

- `src/contextProcessor.ts:115`

### 'SafeStorage' is an 'error' type that acts as 'any' and overrides all other types in this union type.

- `src/encryptionService.ts:6`

### Invalid type "number[]" of template literal expression.

- `src/search/indexOperations.ts:190`

### Expected the Promise rejection reason to be an Error.

- `src/services/webViewerService/webViewerServiceActions.ts:86`

### 'value' will use Object's default stringification format ('[object Object]') when stringified.

- `src/services/webViewerService/webViewerServiceHelpers.ts:39`

### 'moment' import is restricted from being used. The 'moment' package is bundled with Obsidian. Please import it from 'obsidian' instead.

- `src/utils.ts:21`

### 'moment' should be listed in the project's dependencies. Run 'npm i -S moment' to add it

- `src/utils.ts:21`

### Invalid type "string[]" of template literal expression.

- `src/utils.ts:499`

### 'options.body' may use Object's default stringification format ('[object Object]') when stringified.

- `src/utils.ts:829`

## Other (2)

### 2 release assets are missing a GitHub artifact attestation (2)

- `main.js`
- `styles.css`

## Disclosures (14)

### Plugin might make requests to 59 external domains (59)

<details><summary>59 locations</summary>

- `127.0.0.1`
- `ai.azure.com`
- `api.anthropic.com`
- `api.brevilabs.com`
- `api.cohere.com`
- `api.deepseek.com`
- `api.firecrawl.dev`
- `api.github.com`
- `api.githubcopilot.com`
- `api.groq.com`
- `api.jina.ai`
- `api.mistral.ai`
- `api.openai.com`
- `api.perplexity.ai`
- `api.siliconflow.com`
- `api.smith.langchain.com`
- `api.supadata.ai`
- `api.x.ai`
- `aws.amazon.com`
- `bedrock-runtime.`
- `beta.smith.langchain.com`
- `cloud.siliconflow.com`
- `cognito-identity-fips.`
- `cognito-identity-fips.us-east-1.amazonaws.com`
- `cognito-identity-fips.us-east-2.amazonaws.com`
- `cognito-identity-fips.us-west-1.amazonaws.com`
- `cognito-identity-fips.us-west-2.amazonaws.com`
- `cognito-identity.`
- `cognito-identity.amazonaws.com`
- `console.anthropic.com`
- `console.aws.amazon.com`
- `console.groq.com`
- `console.mistral.ai`
- `console.x.ai`
- `dashboard.cohere.ai`
- `dev.smith.langchain.com`
- `eu.smith.langchain.com`
- `generativelanguage.googleapis.com`
- `github.com`
- `i.ytimg.com`
- `lexical.dev`
- `localhost`
- `makersuite.google.com`
- `mermaid.ink`
- `models.brevilabs.com`
- `obsidiancopilot.com`
- `ollama.com`
- `openrouter.ai`
- `platform.deepseek.com`
- `platform.openai.com`
- `reactjs.org`
- `runtime.sagemaker.`
- `smith.langchain.com`
- `sts-fips.`
- `sts.`
- `sts.amazonaws.com`
- `tiktoken.pages.dev`
- `www.obsidiancopilot.com`
- `www.youtube.com`

</details>

### License `AGPL-3.0` is a copyleft license

### Found 18 `fetch()` calls

### **Vault Enumeration**: Enumerates all files in the vault (`vault.getFiles`, `getMarkdownFiles`, etc.). Gives the plugin access to every file path in the vault.

### **Clipboard Access**: Reads or writes the system clipboard. May expose content copied from outside Obsidian.

### **Local Storage**: Persists data in `localStorage` or `sessionStorage` instead of the Obsidian plugin data APIs

### Built file contains TypeScript ES5 transpilation helpers (`__awaiter`, `__generator`, `__spreadArray`)

- `"target"`
- `tsconfig.json`
- `"ES6"`

### **Vault Read**: Reads individual vault files via the Obsidian API (`vault.read`, `vault.cachedRead`)

### **Vault Write**: Creates or modifies vault files via the Obsidian API (`vault.modify`, `vault.create`, etc.)

### Malware scan not available.

### Vulnerable dependencies scan not available.

### Obfuscation scan not available.

### Network requests scan not available.

### Build verification not available.
