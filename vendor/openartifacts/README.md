# OpenArtifacts shared publishing rules

`SKILL.md` is an unmodified snapshot from the commit and path in `source.json`.
The source SHA-256 protects against accidental edits. Copilot bundles only its
shared publishing rules; the host adapter owns execution and approval.

To identify the snapshot for a particular Copilot release, inspect `source.json`
at that release tag. Its `commit` pins the OpenArtifacts source revision, and
`sha256` verifies the exact vendored file bytes. Several Copilot releases may
share the same pin. The npm `latest` tag does not affect an installed Copilot
release. The preview renderer and wrappers belong to Copilot source; this pin
describes the shared rules, not the complete npm package.

`OPENARTIFACTS_PUBLISH_VERSION` is the built-in skill revision used to refresh
Copilot-managed installed copies. It is not an npm package version or the
Copilot release version. Updating the snapshot requires a Copilot release to
reach normal users; publishing npm alone does not update those copies.

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
