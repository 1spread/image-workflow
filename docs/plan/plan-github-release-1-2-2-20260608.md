# plan-github-release-1-2-2-20260608

## Goal

Publish GitHub release `1.2.2` so the pushed manifest version has a matching release for Obsidian installation/update.

## Steps

- [x] Confirm `main` is clean and synced with `origin/main`.
- [x] Confirm `manifest.json` points to `1.2.2`.
- [x] Confirm no `1.2.2` GitHub release exists yet.
- [x] Create and push tag `1.2.2`.
- [x] Create GitHub release `1.2.2` with plugin assets.
- [x] Verify release exists.

## Current Status

- Tag `1.2.2` was created locally and pushed to GitHub.
- GitHub release creation failed because the current GitHub CLI token lacks the required `workflow` scope.
- Next required action: explicitly approve refreshing GitHub CLI auth with `workflow` scope, or run `gh auth refresh -h github.com -s workflow` manually.

## Account Follow-up

- [x] Switch GitHub CLI active account from `daisuke-ignite` to `1spread`.
- [x] Re-check token scopes for the active account.
- [x] Retry release creation under the `1spread` account.

## Result

- Published release: https://github.com/1spread/image-workflow/releases/tag/1.2.2
- Attached assets: `main.js`, `manifest.json`, `styles.css`.
- Root cause of release failure: GitHub CLI active account was `daisuke-ignite`; switching to `1spread` allowed release creation.
