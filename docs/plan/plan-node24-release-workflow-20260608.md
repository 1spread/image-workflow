# Plan: Add Node 24 Release Workflow - 2026-06-08

## Goal

Add a GitHub Actions release workflow for `1spread/image-workflow` that runs on Node.js 24 and publishes Obsidian plugin release assets from version tags.

## Steps

- [x] Confirm repository is `1spread/image-workflow`.
- [x] Confirm active GitHub CLI account is `1spread`.
- [x] Confirm the repository currently has no `.github/workflows` directory.
- [x] Add a Node 24 release workflow.
- [x] Validate workflow YAML.
- [x] Run local build verification.
- [x] Commit and push to `origin/main`.
- [x] Record final result.

## Notes

- Use `actions/checkout@v6` and `actions/setup-node@v6`; both use the Node 24 action runtime.
- Use `node-version: 24` for the build runtime.
- Publish Obsidian plugin assets: `main.js`, `manifest.json`, and `styles.css`.

## Verification

- Parsed `.github/workflows/release.yml` with Ruby YAML successfully.
- `git diff --check` passed.
- `npm run build` passed after installing dependencies with `npm ci`.
- Pushed `ci: add node 24 release workflow` to `origin/main`.

## Follow-up

- `npm ci` reported one moderate vulnerability in the dependency tree. It was not addressed here because this task is limited to adding the Node 24 release workflow.
