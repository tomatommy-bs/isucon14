---
title: "webapp/etc/tuning-logを1つのモノレポに統合(EC2実パスに忠実な構成)"
date: 2026-08-01
tags: [process, git-management, team-workflow, infra, monorepo]
repo: etc
logs: []
---

## 計測値

0009で`webapp`・`etc`・`tuning-log`(ダッシュボード)をそれぞれ別リポジトリ(`isucon14-webapp`・`isucon14-etc`・`isucon14`)として運用していたが、これは「変更が複数リポジトリに分散して追いにくい」という0009自身が解決しようとした課題を、1段上のレベルで再発させていた。

## 仮説

3リポジトリを1つの`isucon14`モノレポに統合すれば、チーム全体の変更を1つの`git log`で横断的に追える。ただし`/etc`と`/home/isucon/webapp`はEC2上で共通の親ディレクトリを`/`しか持たないため、単純に1つの作業ツリー直下へ実ファイルとして同居させることはできない(それをやると結局ルート全体をgit管理する案に逆戻りしてしまう)。

## 変更

`git subtree`を使い、サーバー側の実体(2つの独立したリポジトリ)を保ったまま、GitHub上だけ1つのモノレポとして統合した。

1. サーバー上の`/etc`・`/home/isucon/webapp`は**従来通り独立したgitリポジトリのまま**(その場で直接コミットできる使い勝手を維持)
2. GitHubに新設した`tomatommy-bs/isucon14`モノレポに対し、`git subtree add --prefix=etc`・`git subtree add --prefix=home/isucon/webapp`でEC2上の実パスに忠実な構成として履歴ごと取り込み
3. 各サブツリーが持っていた`.github/workflows/`はGitHub Actionsがリポジトリルートしか見ないため、モノレポルートの`.github/workflows/`へ移動し、`paths`フィルタと内部コマンドのパス(`etc/nginx/`、`home/isucon/webapp/nodejs/`等)を新しい配置に合わせて修正
4. `tuning-log/tuning-log.config.json`の`repos`マッピングを新モノレポのURLに更新
5. 旧`isucon14-webapp`・`isucon14-etc`単体リポジトリは統合元として残すが、今後のコミット先はモノレポ

## 検証

- `tuning-log`をビルドし、10件のエントリすべてが正しくレンダリングされることを確認
- 旧リポジトリのコミットハッシュ(例: 0009の`29a296d`)がsubtree統合後もモノレポの履歴内に存在し続けることを`git cat-file -t`で確認(コミットリンクが引き続き有効)
- 今後の運用: サーバー上の`/etc`・`/home/isucon/webapp`での変更→コミットは今まで通り。共有したいタイミングで`git subtree push --prefix=<path> <モノレポ> master`を実行し、モノレポ側に反映する(逆方向はsubtree pull)
