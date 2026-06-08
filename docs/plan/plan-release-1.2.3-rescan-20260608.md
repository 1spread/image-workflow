# Plan: Release 1.2.3 For Rescan - 2026-06-08

## Goal

Bump `image-workflow` from `1.2.2` to `1.2.3` so the Obsidian scanner sees a new manifest version and can run a fresh scan.

## Steps

- [x] Confirm working tree is clean on `main`.
- [x] Confirm active GitHub account is `1spread`.
- [x] Confirm tag/release `1.2.3` does not already exist.
- [x] Update version metadata to `1.2.3`.
- [x] Run local build verification.
- [ ] Commit and push version metadata.
- [ ] Create and push tag `1.2.3`.
- [ ] Watch release workflow.
- [ ] Verify GitHub Release `1.2.3`.
- [ ] Record final result.

## Notes

- The scanner message means `1.2.2` has already been scanned; a new manifest version is required for another scan.
- This release exists to refresh the scan target after the repository workflow update.

## Verification

- `npm run build` passed with `image-workflow@1.2.3`.
- `git diff --check` passed.
