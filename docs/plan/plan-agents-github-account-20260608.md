# plan-agents-github-account-20260608

## Goal

Add repository instructions so future GitHub release/push work uses the `1spread` GitHub CLI account instead of accidentally using `daisuke-ignite`.

## Steps

- [x] Check whether `AGENTS.md` already exists.
- [x] Create or update `AGENTS.md` with GitHub CLI account guidance.
- [x] Verify file contents.

## Result

- Created root `AGENTS.md`.
- Added guidance to check `gh auth status -h github.com` and switch to `1spread` with `gh auth switch -u 1spread` before GitHub release/asset upload work.
- Added note that the prior `workflow` scope-looking release error was actually caused by `daisuke-ignite` being the active GitHub CLI account.
