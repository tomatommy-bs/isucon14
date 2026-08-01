---
title: "owner/chairsの走行距離集計をキャッシュ方式に変更（根本対応）"
date: 2026-07-28
tags: [n+1, sql, cache-column, window-function, design-change]
commit: "a7caa4d"
repo: webapp
metrics:
  before:
    score: 1517
  after:
    score: 2720
logs:
  - label: "pt-query-digest (after)"
    path: "bench_logs/20260728_235747/mysql_slow.log"
---

## 計測値

0001/0002/プロセス内部プロファイリング(`--prof`)の3つの独立した手法全てから「owner/chairsのボトルネックはSQL（`LAG`ウィンドウ関数による走行距離の毎回全件集計）」と裏付け済み。インデックスでは解決不能と判明していた。

## 仮説

`distance`は他エンティティとの距離ではなく、その椅子自身の位置履歴の累積移動距離（オドメーター）。POSTのたびに累積させるcacheカラムを導入すれば、毎回の全件再集計が不要になるはず。

## 変更

1. `chairs`に`total_distance INTEGER NOT NULL DEFAULT 0`・`total_distance_updated_at DATETIME(6) NULL`を追加
2. `chairPostCoordinate`: 新座標をINSERTする前に直前の座標を取得し、差分（マンハッタン距離）を`UPDATE chairs SET total_distance = total_distance + ?`で加算
3. `ownerGetChairs`: 巨大な`LEFT JOIN`サブクエリを削除し、`total_distance`列を素直に`SELECT`するだけに簡略化

シードデータとの整合性の都合で、スキーマへのカラム追加は`1-schema.sql`ではなく初期データ投入後の別ステップ（`4-total-distance-cache.sql`、元の重い`LAG`集計で1回だけバックフィル）に分離。

## 検証

- `EXPLAIN`: `derived`テーブル・`LAG`・`filesort`が全て消え、`chairs.owner_id`のインデックスを使った単純な`type: ref`ルックアップに変化
- 手動テスト: `POST /api/chair/coordinate`で座標を1件送信 → `total_distance`が128→168（移動量+40と一致）に正しく差分加算されることを確認
- ベンチマーク実測: **スコア 1517 → 2720（約1.8倍）**
- `pt-query-digest`比較: 全クエリ実行時間合計249秒→**115秒**、QPS 1.79k→**3.27k**。`chair_locations`集計クエリ（旧1位、77.5%）が**ランキングから完全に消滅**。新1位は`COMMIT`（51.5%、→ 0004で対応）
