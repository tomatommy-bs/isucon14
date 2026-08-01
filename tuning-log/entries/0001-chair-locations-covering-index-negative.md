---
title: "chair_locationsへのカバリングインデックス追加（学習目的、効果なしと判明）"
date: 2026-07-28
tags: [index, mysql, negative-result, window-function]
commit: "f2e283d"
repo: webapp
metrics:
  before:
    score: 625
  after:
    score: 822
logs: []
---

## 計測値

`owner/chairs`の1位クエリ（走行距離集計、`LAG`ウィンドウ関数）を`EXPLAIN`で確認。`chairs`テーブル自体もフルスキャン（`owner_id`未インデックス）、`chair_locations`もフルスキャン+`Using filesort`。

## 仮説

`chair_locations(chair_id, created_at)`のインデックスを追加すれば`type: ALL`が解消するはず。

## 変更

1. `chair_locations(chair_id, created_at)` を追加 → 効果なし（`type: ALL`のまま）
2. カバリングインデックス`chair_locations(chair_id, created_at, latitude, longitude)`に変更

## 検証

- (2)で`type: ALL → index`、`Using index`は付与されたが**`Using filesort`は解消せず**（ネストしたderived table構造のため、ウィンドウ関数のソート省略をオプティマイザが認識できない）
- 単発クエリの実行時間はインデックス有無でほぼ差がなかった（0.18〜0.21秒）。ベンチマーク実測でもスコアは625→822と伸びたが、`pt-query-digest`で見るとこのクエリのR/Callも全体シェアも**改善なし**。スコア向上は別要因（後の20章のインデックス追加）によるもので、**このカバリングインデックスは実質的に無意味だった**

### 学び
インデックスで解決できるのは「対象を絞り込む」クエリのみ。「ほぼ全件を毎回読んで集計し直す」設計のクエリにはインデックスは効かず、根本的にはクエリ設計（差分加算方式への変更、→ 0003参照）が必要。単発の実行時間比較だけでは負荷下の効果を正しく評価できない点も要注意。
