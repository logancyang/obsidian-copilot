/**
 * English translations for Obsidian Copilot
 */
export default {
  // Chat UI
  chat: {
    newChat: "New Chat",
    send: "Send",
    sendMessage: "Send message",
    stopGenerating: "Stop generating",
    dropFilesHere: "Drop files here...",
    saveAsNote: "Save Chat as Note",
    copy: "Copy",
    delete: "Delete",
    cancel: "Cancel",
    confirm: "Confirm",
    regenerate: "Regenerate",
    edit: "Edit",
    untitledConversation: "Untitled Conversation",
    noResults: "No results",
    loadingModels: "Loading models...",
  },

  // Messages
  messages: {
    messageNotFound: "Message not found.",
    cannotRegenerateFirst: "Cannot regenerate the first message.",
    failedToSend: "Failed to send message. Please try again.",
    failedToRegenerate: "Failed to regenerate message. Please try again.",
    failedToEdit: "Failed to edit message. Please try again.",
    failedToDelete: "Failed to delete message. Please try again.",
    failedToRegenerateAI: "Failed to regenerate AI response. Please try again.",
    failedToSave: "Failed to save chat as note. Check console for details.",
    failedToLoadHistory: "Failed to load chat history.",
    failedToUpdateTitle: "Failed to update chat title.",
    failedToDeleteChat: "Failed to delete chat.",
    failedToLoadChat: "Failed to load chat.",
    failedToOpenSource: "Failed to open source file.",
  },

  // Loading states
  loading: {
    default: "",
    readingFiles: "Reading files",
    searchingWeb: "Searching the web",
    readingFileTree: "Reading file tree",
    compacting: "Compacting",
  },

  // Project
  project: {
    add: "Add Project",
    edit: "Edit Project",
    delete: "Delete Project",
    projectAdded: "added successfully",
    projectUpdated: "updated successfully",
    projectAddedContextLoaded: "added and context loaded",
    projectUpdatedContextReloaded: "updated and context reloaded",
    projectAddedContextFailed: "added but context loading failed",
    projectUpdatedContextFailed: "updated but context reload failed",
    projectAlreadyExists: "Project \"{{name}}\" already exists, please use a different name",
    projectDoesNotExist: "does not exist",
  },

  // Model
  model: {
    selectModel: "Select Model",
    addModel: "Add Model",
    unknownModel: "Unknown Model",
    noActiveModel: "No active model is configured. Please configure a model in Copilot settings.",
    noModelKey: "No model key found. Please select a model in settings.",
  },

  // Settings
  settings: {
    title: "Copilot Settings",
    reload: "Reload Plugin",
    reloadSuccess: "Plugin reloaded successfully.",
    reloadFailed: "Failed to reload the plugin. Please reload manually.",
    testFailed: "Test operation failed",
    invalidLicense: "Invalid license key",
  },

  // Errors
  errors: {
    inputValidationFailed: "Input validation failed",
    invalidInput: "Invalid input",
    invalidOperation: "Invalid operation",
    networkFailed: "Network request failed",
    failedFetch: "Failed to fetch",
    failedLoadContent: "Failed to load content",
    failedCopyClipboard: "Failed to copy to clipboard",
    pleaseFillRequired: "Please fill in all required fields",
  },

  // Tools
  tools: {
    webSearch: "Web Search",
    vaultSearch: "Vault Search",
    activeNote: "Active Note",
    ignoreFiles: "Ignore Files",
    forceReindex: "Force Reindex Vault",
  },

  // Copilot Plus
  plus: {
    copilotPlus: "Copilot Plus",
  },

  // Misc
  misc: {
    none: "None (use built-in prompt)",
    noCustomPrompts: "No custom prompt files found.",
    noRelevantDocs: "No relevant documents found.",
  },
};
