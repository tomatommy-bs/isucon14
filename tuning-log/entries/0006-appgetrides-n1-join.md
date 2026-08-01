---
title: "appGetRidesのN+1解消"
date: 2026-07-29
tags: [n+1, sql, node]
commit: "01362bd"
repo: webapp
metrics:
  before:
    score: 3117
  after:
    score: 3314
logs:
  - label: "pt-query-digest (after)"
    path: "bench_logs/20260729_004646/mysql_slow.log"
  - label: "alp (after)"
    path: "bench_logs/20260729_004646/nginx_access.log"
---

## 計測値

`pt-query-digest`で`SELECT status FROM ride_statuses WHERE ride_id = ? ORDER BY created_at DESC LIMIT 1`が1位（66秒間で27,041回呼び出し、13.2%）。`EXPLAIN`では`type: ref`・`rows: 6`と、クエリ自体は既に効率的。

## 仮説

「遅いクエリ」ではなく「呼びすぎ」のN+1パターン。`appGetRides`が`rides`を全件取得後、ループ内で1件ずつ`getLatestRideStatus`を呼んでいる。`rides`を集約単位としてJOINで1回にまとめられるはず。

## 変更

```sql
SELECT r.* FROM rides r
JOIN ride_statuses rs ON rs.ride_id = r.id
WHERE r.user_id = ?
  AND rs.created_at = (SELECT MAX(created_at) FROM ride_statuses rs2 WHERE rs2.ride_id = r.id)
  AND rs.status = 'COMPLETED'
ORDER BY r.created_at DESC
```

## 検証

`EXPLAIN`で全参照が`type: ref`（フルスキャンなし）であることを事前確認してから適用。ベンチマーク実測で**スコア 3117 → 3314（+6.3%）**。
