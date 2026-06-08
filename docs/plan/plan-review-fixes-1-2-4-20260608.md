# Plan: Review Fixes 1.2.4 - 2026-06-08

## Goal

Resolve the actionable Obsidian review findings reported for `1.2.3`, publish a new `1.2.4` patch release, and verify release assets.

## Steps

- [x] Preserve the dirty worktree before updating the base.
- [x] Fast-forward local `main` to current `origin/main`.
- [x] Apply source, CSS, README, and dependency fixes.
- [x] Update version metadata to `1.2.4`.
- [x] Run local verification and static scans.
- [ ] Commit, push, tag, and verify the `1.2.4` release.

## Notes

- Clipboard access remains expected plugin behavior.
- The release workflow on `origin/main` builds assets and creates artifact attestations.
- Keep intentionally inline clipboard HTML formatting unless the review scanner flags it again.

## Verification

- `node node_modules/typescript/lib/tsc.js --noEmit` passed.
- `npm run build` passed and regenerated `main.js`.
- `git diff --check` passed.
- `npm audit --omit=dev` passed with 0 vulnerabilities.
- `gh auth status -h github.com` shows active account `1spread`.
- Static scans no longer find `execCommand`, `fetch(`, `instanceof HTMLImageElement`, global `document.`/`window.`, direct `.style.`/`style.cssText`, or README placeholder text.
- Remaining `setAttribute('style')` calls are limited to serialized clipboard HTML formatting for external paste targets.
