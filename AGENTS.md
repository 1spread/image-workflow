# Repository Instructions

- タスクが渡されたら必ず `plan.md` を作ること。
- 作成する場所が分からなければ `/docs/plan/` のフォルダに作ること。
- `plan.md` は prefix で `plan-{taskname}-{yyyymmdd}` で作ること。
- 作成した md を随時更新して plan をアップデートすること。

## GitHub CLI Account

- このリポジトリは `1spread/image-workflow` なので、GitHub release 作成や GitHub CLI 操作の前に active account が `1spread` であることを確認すること。
- 確認コマンド: `gh auth status -h github.com`
- `daisuke-ignite` が active の場合は、先に `gh auth switch -u 1spread` を実行してから release 作成や asset upload を行うこと。
- `workflow` scope 不足に見える release 作成エラーでも、まず active account が `1spread` か確認すること。前回は `daisuke-ignite` が active だったことが原因で、`1spread` に切り替えると `1.2.2` release を作成できた。

