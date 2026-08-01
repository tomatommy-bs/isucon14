# isucon-toolkit

ISUCON（本番・過去問練習）向けの、パフォーマンスチューニング履歴管理ツール。

Claude Code などのAIエージェントが、計測→仮説→変更→コミット→再計測というチューニングサイクルを回すたびに
`entries/` 配下にエントリを追記していくことを前提にした、Astro製の静的サイトジェネレータです。

## 使い方(競技当日)

1. 配布されたソースコードのリポジトリ直下に、このリポジトリを丸ごとクローン(フォルダ名は `tuning-log` を推奨)
   ```sh
   git clone git@github.com:tomatommy-bs/isucon-toolkit.git tuning-log
   ```
2. `npm install`
3. チューニング作業を進めながら、Claude Codeに「計測→仮説→変更→検証」のサイクルごとに
   `entries/` へエントリを追記させる(スキーマ・運用ルールは [AGENTS.md](./AGENTS.md) 参照)
4. `npm run dev` でローカルにダッシュボードを起動し、ブラウザで履歴を確認

## コマンド

| コマンド | 内容 |
| :--- | :--- |
| `npm install` | 依存関係インストール |
| `npm run dev` | 開発サーバー起動（`localhost:4321`） |
| `npm run build` | 静的サイトを `./dist/` にビルド |
| `npm run preview` | ビルド結果をローカルでプレビュー |

## ディレクトリ構成

```text
/
├── entries/              # チューニング履歴エントリ(Markdown + frontmatter)。ここに追記していく
├── src/
│   ├── content.config.ts # entries のfrontmatterスキーマ定義
│   └── pages/
│       ├── index.astro          # タイムライン一覧 + スコア推移グラフ
│       └── entries/[id].astro   # エントリ詳細ページ
└── package.json
```

## エントリのスキーマ

`entries/*.md` は以下のfrontmatterを持つ:

```yaml
---
title: "appGetRidesのN+1解消"
date: 2026-07-29
tags: [n+1, sql, node]
commit: "01362bd"        # このチューニング変更のコミットハッシュ(任意)
repo: webapp              # 対象リポジトリ名(任意、複数リポジトリを横断管理する場合に区別)
metrics:
  before: { score: 3117 } # 自由なkey-value。グラフ化には metrics.after.score を使う
  after:  { score: 3314 }
logs:
  - label: "pt-query-digest (after)"
    path: "bench_logs/20260729_004646/mysql_slow.log"  # ログ本体はコピーせず相対パス参照のみ
---

## 計測値
## 仮説
## 変更
## 検証
```

詳しい運用ルール(いつエントリを作るか等)は [AGENTS.md](./AGENTS.md) を参照。

## toolkit自体の開発

Astro (v7) を使用。ページ追加やcontent collectionsの変更は[Astro公式ドキュメント](https://docs.astro.build)を参照。
