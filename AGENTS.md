# isucon-toolkit 運用マニュアル(AI向け)

このリポジトリは、ISUCONのパフォーマンスチューニング作業を進めるAIエージェント(Claude Code等)自身が、
`entries/` にチューニング履歴を書き残していくための道具です。人間が手で全件書く前提ではありません。

## いつエントリを作るか

以下の**1サイクルが完結するたび**に1エントリを作成する。「変更を適用した」だけではまだ作らず、
必ず**再計測してから**書く(仮説が外れた場合もその旨を書く。外れた記録も価値がある)。

1. 計測（EXPLAIN, pt-query-digest, alp, `--prof`等で現状のボトルネックを特定）
2. 仮説（なぜ遅いと考えたか）
3. 変更（具体的な変更内容、コミット）
4. 再計測・検証（変更後の計測値、ベンチマークスコアの差分）

## エントリの作り方

1. `entries/` 内の既存ファイルを確認し、連番を1つ進める(例: 既存が `0012-*.md` までなら次は `0013-*.md`)
2. ファイル名は `NNNN-短い英語スラッグ.md`（例: `0013-owner-chairs-cache-column.md`）
3. 以下のfrontmatterスキーマ（`src/content.config.ts` で検証される）に従う:

   ```yaml
   ---
   title: "日本語での短いタイトル"
   date: YYYY-MM-DD
   tags: [n+1, sql, index, mysql-config, ...]  # 自由。既存エントリのタグを再利用して揺れを減らす
   commit: "コミットハッシュ"        # 任意。このリポジトリ内のコミットでなくても良い(対象アプリのコミット)
   repo: webapp                       # 任意。対象リポジトリ名(webapp/nginx/mysql等、複数リポジトリを横断する場合に区別)
   metrics:
     before: { score: 3117 }          # 自由なkey-value。score は必ずこのキー名で入れる(グラフ化対象)
     after:  { score: 3314 }
   logs:
     - label: "pt-query-digest (after)"
       path: "bench_logs/20260729_004646/mysql_slow.log"  # このリポジトリ内に実在しなくてよい。
                                                            # 対象サーバー上の実際のログ格納場所を書くドキュメント目的の参照
   ---
   ```

4. 本文は最低限、次の見出しを含める(順不同・自由記述):
   - `## 計測値` — 何を見て、何がわかったか(生の数値・EXPLAIN結果の要点など)
   - `## 仮説` — なぜそうなっていると考えたか
   - `## 変更` — 具体的に何を変えたか(SQL・コード差分の要点)
   - `## 検証` — 変更後の計測値、ベンチマークスコアの差分。仮説が外れた場合はその旨も書く

## 命名・タグの一貫性

- `metrics.after.score` は必ず**ISUCONベンチマークのスコア**を入れる(トップページの推移グラフはこのキーのみを見る)
- それ以外の指標(QPS、特定クエリの割合等)は `metrics.before`/`metrics.after` に自由なキーで追加してよいが、
  グラフ化はされず詳細ページの表にのみ表示される
- タグは新しく作る前に既存エントリ(`entries/*.md`)を`grep`して再利用できないか確認する

## 確認方法

```sh
npm run dev
```

でローカルにダッシュボードが立つので、追記したエントリが正しくパースされているか(スキーマ違反があると
ビルド/dev起動時にエラーになる)を確認してから、対象アプリのリポジトリ側のコミットを進める。

## 複数リポジトリ構成での注意

ISUCONでは「アプリ本体のリポジトリ」と「このtuning-logリポジトリ」が別リポジトリになる想定。
`commit` フィールドはアプリ側リポジトリのハッシュを指すため、このリポジトリ自身のgit historyとは対応しない。
そのため `entries/*.md` を編集した際は、このリポジトリ側でも都度コミットしてよい(頻度は問わない)。

---

## toolkit自体(Astroサイト)を開発する場合

### Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

### Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
