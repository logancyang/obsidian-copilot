export const galleryHostFixtures = Object.freeze({
  confirmation: Object.freeze({
    body: "The local agent configuration and its saved command history will be removed.",
    confirmLabel: "Delete configuration",
    title: "Delete local agent configuration?",
  }),
  popover: Object.freeze({
    actions: Object.freeze(["Copy response", "Insert at cursor", "Start a new chat"]),
    description: "Choose what to do with the latest assistant response.",
  }),
  settings: Object.freeze({
    description: "Use the configured fallback when the preferred model is unavailable.",
    title: "Allow model fallback",
  }),
});
