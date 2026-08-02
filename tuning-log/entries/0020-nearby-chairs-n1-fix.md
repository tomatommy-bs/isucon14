---
title: "appGetNearbyChairsのN+1(全chairs×2クエリ)を3クエリに集約"
date: 2026-08-03
tags: [n+1, sql, cpu]
commit: "b7f1768"
repo: webapp
metrics:
  before: { score: 5971 }
  after: { score: 6176 }
verboseLogging: false
logs:
  - label: "旧クエリ(chair_id別rides全件取得、ORDER BY created_at DESC・LIMITなし)の出現回数"
    path: "bench_logs/20260803_005839/mysql_slow.log, bench_logs/20260803_010558/mysql_slow.log"
    excerpt: "修正前: 2769回 → 修正後: 0回(完全に除去)"
  - label: "新クエリ(SELECT DISTINCT chair_id FROM rides ...)の出現回数"
    path: "bench_logs/20260803_010558/mysql_slow.log"
    excerpt: "159回(呼び出しごとに1回、想定通り)"
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_005839, 20260803_005954, 20260803_010109"
    excerpt: "entries/0019のafter計測をそのままbeforeとして使用: 5567(verbose) / 6576 / 5971 → 中央値5971"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_010558, 20260803_010714, 20260803_010829"
    excerpt: "6176(verbose) / 5845 / 6825 → 中央値6176"
---

## 計測値

`appGetNearbyChairs`(app_handlers.ts)を読み直したところ、`SELECT * FROM chairs`で
取得した**全椅子**(537台)をループし、`is_active`な椅子ごとに

1. `SELECT * FROM rides WHERE chair_id = ? ORDER BY created_at DESC`(全件、未完了ライドが
   無いか判定するため)
2. `SELECT * FROM chair_locations WHERE chair_id = ? ORDER BY created_at DESC LIMIT 1`
   (最新位置情報)

の2クエリを個別に発行する、典型的なN+1になっていた。entries/0015でこの判定に必要な
`ride.latest_status`をキャッシュ列として追加済みだったため、判定ロジック自体は既に
簡略化されていたが、クエリの発行回数(全椅子分)は変わっていなかった。

## 仮説

判定に必要な情報を、椅子ごとの個別クエリではなく一括取得クエリに置き換えられる。

- 未完了ライドを持つ椅子IDの集合は`SELECT DISTINCT chair_id FROM rides WHERE chair_id IS NOT NULL
  AND latest_status <> 'COMPLETED'`の1クエリで取得できる(`rides.latest_status`キャッシュ列のおかげで
  `ride_statuses`へのJOINが不要になっている)。
- 全椅子の最新位置情報は、`chair_locations`を`chair_id`でGROUP化した`MAX(created_at)`と自己JOINする
  1クエリで一括取得できる。

これで椅子の台数に関わらずクエリ数が定数(3クエリ)になり、CPU使用率の逼迫緩和に寄与するはず。

## 変更

`appGetNearbyChairs`で、ループ内の2クエリを削除し、ループ前に上記2つの一括取得クエリ
(`busyChairIds`集合、`latestLocationByChairId`マップ)を追加。ループ内はメモリ上の
`Set`/`Map`参照のみで判定するように変更。レスポンスの並び順(`SELECT * FROM chairs`の
デフォルト順を維持したままフィルタ)は変更していない。
コミット: `b7f1768`(isucon14-webapp側は`git subtree push`で同期済み: `6171145`)

## 検証

直前(entries/0019)のafter計測をそのままbeforeとして使用(5567 / 6576 / 5971、中央値5971)。

- after: 6176(verboseLogging=true) / 5845 / 6825 → 中央値6176(約+3.4%)

仮説の根拠にした指標を、修正前後の生ログへの`grep`で直接比較した。旧クエリパターン
(`chair_id`指定+`ORDER BY created_at DESC`+LIMITなし、他のchair_id系クエリと文字列上
区別できる特徴的な形)は修正前2769回→修正後0回で完全に除去を確認。新クエリ
(`SELECT DISTINCT chair_id FROM rides ...`)は修正後159回発行されており、呼び出し回数分
だけ実行されていることも確認できた。entries/0019(バイナリログ無効化)がスコア面では
不確定だった直後の計測のため、before/after双方のブレ幅を考慮すると+3.4%は確実な改善とは
言い切れないが、クエリ削減という狙った変化自体は明確に確認できている。
