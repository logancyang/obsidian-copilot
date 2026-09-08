# OpenArtifacts shared publishing rules

`SKILL.md` is an unmodified snapshot from the commit and path in `source.json`.
The source SHA-256 protects against accidental edits. Copilot bundles only its
shared publishing rules; the host adapter owns execution and approval.

This snapshot includes rules prepared for OpenArtifacts 0.2.1. It does not claim
parity with the currently published npm 0.2.0 package. Vendoring keeps clean
installs, builds, and publishing independent of that unreleased npm version.
Neither the build nor the installed skill fetches instructions from the network.

To update, copy `SKILL.md` from an explicitly reviewed upstream commit, update
`source.json` with that commit, path, and the copied file's SHA-256, then run:

```sh
npm run sync:openartifacts-skill
npm run sync:openartifacts-skill -- --check
```

Commit the source, provenance, and generated TypeScript together. Increment
`OPENARTIFACTS_PUBLISH_VERSION` when the installed skill's content changes so
existing vaults receive the bundled update. The unit suite runs the offline
consistency check; normal builds use the checked-in generated TypeScript.
