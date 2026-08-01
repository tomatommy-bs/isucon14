---
title: "/etc全体を単一gitリポジトリに統合し、チーム共有のためGitHubへpush"
date: 2026-08-01
tags: [process, git-management, team-workflow, infra]
commit: "29a296d"
commitUrl: "https://github.com/tomatommy-bs/isucon14-etc/commit/29a296d"
repo: etc
logs: []
---

## 計測値

これまで`/etc/nginx`・`/etc/mysql`をそれぞれ別のgitリポジトリとして管理していた（0004等参照）。実際の競技を想定すると以下の課題があった。

- 変更が複数リポジトリに分散し、「サーバー全体で今何が変わっているか」を横断的に追いにくい
- チーム戦では変更内容を**共有・永続化**しないと、メンバー間で設定の上書き事故が起きうる（誰かが変更した設定を知らずに別の人が戻してしまう等）

## 仮説

ルート(`/`)全体をgit管理するのはノイズ（`/var/lib/mysql`の実データ、機密ファイル等）が大きすぎて非現実的。一方で「変更が起きうる設定ファイル群」である`/etc`だけに絞れば、1つのリポジトリで横断的に追いつつノイズも抑えられるはず（`etckeeper`という定番OSSと同様の発想）。`webapp`（配布されたアプリケーション本体）は元々isucon所有で性質が異なるため、統合対象からは外し従来通り別リポジトリのままとする。

## 変更

1. `/etc/nginx`・`/etc/mysql`の個別git履歴を`.git.bak`として退避(削除はしない)
2. `/etc`直下に`.gitignore`を作成。デフォルトでは全ファイルを追跡し、以下のみ除外:
   - 秘密鍵(`*.key`, `ssh_host_*_key`, `ssl/private/`)
   - パスワード/認証情報を含むファイル(`shadow`, `gshadow`, `security/opasswd`, `mysql/debian.cnf`)
   - 揮発性・自動生成ファイル(`machine-id`, `resolv.conf`, `*.pid`等)
3. コミット前に、ステージ対象全ファイルへ`grep -m1 "PRIVATE KEY"`を実行し、名前ベースの除外漏れがないか内容面でも二重チェック
4. GitHubに新規privateリポジトリ`tomatommy-bs/isucon14-etc`を作成し、サーバー専用のデプロイキー(write権限)を発行してpushできるようにした

## 検証

- ステージ対象1,638ファイルを事前に`git add -A -n`(dry-run)で確認し、機密情報混入がないことをキーワード検索＋内容スキャンの両方で確認してからコミット
- サーバーから直接`git push`できることを、テスト用の空コミットで確認（後に取り消し済み）
- 今後の運用: `/etc`配下の設定変更は全て、`webapp`とは別に`isucon14-etc`リポジトリへコミット・pushしていく。このtuning-logの`repo: etc`のエントリは、`tuning-log.config.json`の設定により自動的に`isucon14-etc`のコミットへリンクされる
