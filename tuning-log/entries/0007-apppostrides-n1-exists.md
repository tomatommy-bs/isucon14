---
title: "appPostRidesのN+1解消（EXISTSクエリ化）"
date: 2026-07-29
tags: [n+1, sql, negative-result, measurement-noise]
commit: "963bde9"
repo: webapp
metrics:
  before:
    score: 3314
  after:
    score: 2581
logs: []
---

## 計測値

0006（appGetRidesのN+1解消）後も`getLatestRideStatus`の呼び出し数がほぼ変わらず（27,041→27,565回）1位のまま。`pt-query-digest`はSQL文字列パターンが同じ呼び出しを1つのフィンガープリントにまとめるため、9箇所ある呼び出し元のうちappGetRides分の削減が埋もれていた。

## 仮説

新規ライド作成時の重複チェック（`appPostRides`、既存の未完了ライドがあれば409を返す処理）でも同じ`getLatestRideStatus`がループ呼び出しされており、こちらは「ライド作成のたびに毎回発生する」ためappGetRidesより頻度が高い主要因のはず。

## 変更

単なる存在チェック（`continuingRideCount > 0`）だけなので、`COUNT`ではなく`EXISTS`で1クエリに集約:
```sql
SELECT EXISTS (
  SELECT 1 FROM rides r
  JOIN ride_statuses rs ON rs.ride_id = r.id
  WHERE r.user_id = ?
    AND rs.created_at = (SELECT MAX(created_at) FROM ride_statuses rs2 WHERE rs2.ride_id = r.id)
    AND rs.status <> 'COMPLETED'
) AS has_active
```
`EXPLAIN`で全参照が`type: ref`であることを事前確認してから適用。

## 検証

- ベンチマーク実測: スコア3314→2543→2581と**2回連続で低下**（-20%程度）
- エラー種別・件数は変化なし、`EXPLAIN`も悪化なし → コード自体の後退ではないと判断
- これがきっかけで「ベンチマーク実行環境と、アプリケーション環境が同一なのが問題なことない？」というユーザーの指摘につながり、測定基盤自体の問題（→ 0008）を発見する契機になった。**仮説検証の結果が期待と逆でも、原因をコードに求める前に測定環境そのものを疑う**という教訓になった一件
