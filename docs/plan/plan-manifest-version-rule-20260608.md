# Plan: Record Manifest Version Rule - 2026-06-08

## Goal

Record the repository rule that any plugin version update must also update `manifest.json`.

## Steps

- [x] Confirm current working tree is clean.
- [x] Add the manifest version rule to `AGENTS.md`.
- [x] Add a plan file documenting the rule update.
- [ ] Commit and push the rule update.

## Notes

- Current `1.2.3` release already updated `manifest.json`.
- Future release work must keep `manifest.json`, `package.json`, `package-lock.json`, `versions.json`, and the release tag aligned.
