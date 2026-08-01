---
title: "ride_statuses/rides/chairsへの検索用インデックス追加"
date: 2026-07-28
tags: [index, mysql, n+1]
commit: "7439814"
repo: webapp
metrics:
  before:
    score: 822
  after:
    score: 1517
logs: []
---

## 計測値

`pt-query-digest`の実行結果から、全ハンドラーのSQLを`grep`で洗い出し。`ride_statuses`最新状態取得（`getLatestRideStatus`等）が実行時間シェア17.3%、R/Call 13.4ms、Rows examine平均1,280行と重い。

## 仮説

以下5つの検索パターンに対応するインデックスがなく、フルスキャンが多発している。

| テーブル | インデックス | 対象クエリ |
|---|---|---|
| `ride_statuses` | `(ride_id, created_at)` | 最新状態取得の全パターン(N+1の主要因) |
| `rides` | `(chair_id, updated_at)` | 椅子に紐づくライド検索 |
| `rides` | `(user_id, created_at)` | ユーザーに紐づくライド検索 |
| `chairs` | `UNIQUE (access_token)` | 椅子認証(毎リクエスト) |
| `chairs` | `(owner_id)` | オーナーの椅子一覧 |

`users`/`owners`は既に`UNIQUE(access_token)`等がスキーマにあり対象から除外。

## 変更

上記5インデックスを`1-schema.sql`に追加。

## 検証

- `EXPLAIN`: `ride_statuses`/`rides`ともに`type: ALL → ref`（rows 6, 1など）に劇的改善。`chairs.access_token`は`UNIQUE`化によりconstテーブル最適化が効くように
- ベンチマーク実測: **スコア822→1517（約1.8倍）**
- `pt-query-digest`比較: `ride_statuses`最新状態取得のシェア17.3%→**1.3%**、R/Call 13.4ms→**0.2ms**（約60倍）、Rows examine平均1,280→**22行**
- `alp`比較: `nearby-chairs`のAVGが1.73s→**0.341s**
- 一方`chair_locations`集計クエリ（0001参照）は未対応のため、他が速くなった相対効果でシェアが43.3%→**77.5%**に増加。次の主要ボトルネックとして残存が明確化（→ 0003で対応）
