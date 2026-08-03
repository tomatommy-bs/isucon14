---
title: "chairs.latest_latitude/longitudeキャッシュ列を追加"
date: 2026-08-03
tags: [n+1, sql, cache-column, cpu]
commit: "15719fe"
repo: webapp
metrics:
  before: { score: 6461 }
  after: { score: 6551 }
verboseLogging: false
logs:
  - label: "appGetNearbyChairs用GROUP BY集計クエリ(SELECT cl.* FROM chair_locations ...)の出現回数"
    path: "bench_logs/20260803_225449/mysql_slow.log(修正前), bench_logs/20260803_230644/mysql_slow.log(修正後)"
    excerpt: "修正前: 103回(平均25.5ms/回、全体の4.8%) → 修正後: 0回(完全に除去)"
  - label: "整合性チェック(バックフィル後)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: "SELECT COUNT(*) FROM chairs WHERE latest_latitude IS NOT NULL → 387(位置情報送信済みの椅子数と一致)"
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_225449, 20260803_225607, 20260803_225723"
    excerpt: "entries/0021のafter計測をそのままbeforeとして使用: 6461(verbose) / 6660 / 5967 → 中央値6461"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_230644, 20260803_230803, 20260803_230921"
    excerpt: "6127(verbose) / 6551 / 6739 → 中央値6551"
---

## 計測値

entries/0021適用後、pidstatでnode(91.6%)がmysqld(80.3%)より相対的にボトルネックに
なっていることを確認した上でpt-query-digestを見直したところ、entries/0020で導入した
`appGetNearbyChairs`用のGROUP BY集計クエリ(`SELECT cl.* FROM chair_locations cl INNER
JOIN (SELECT chair_id, MAX(created_at) ... GROUP BY chair_id) latest ON ...`)が、
呼び出し回数自体は103回と少ないものの平均25.5ms/回(全クエリの中で最も遅い部類)、
合計で全体の4.8%を占めていた。`EXPLAIN`では「Using index for group-by」(ルーズインデックス
スキャン)が使われており実行計画自体は既に効率的だったが、`chair_locations`は
`chairPostCoordinate`が呼ばれるたびに増え続けるテーブル(この時点で33116行)であり、
ベンチマークが進むほど遅くなっていく性質を持つ。

## 仮説

`appGetNearbyChairs`が本当に必要としているのは「各椅子の直近1件の座標」だけであり、
これは`chairPostCoordinate`側で書き込み時にキャッシュしておける値(entries/0015の
`rides.latest_status`、entries/0021の`rides.discount`と同じパターン)。`chairs`テーブル自体に
`latest_latitude`/`latest_longitude`を持たせれば、`appGetNearbyChairs`は`chair_locations`に
一切触れずに定数コストで最新座標を得られ、`chair_locations`の行数増加の影響を受けなくなる。

## 変更

- `sql/7-chairs-latest-location-cache.sql`: `chairs`に`latest_latitude`/`latest_longitude`
  (NULL許容、INTEGER)を追加し、`chair_locations`から最新1件をバックフィル。entries/0015・0021と
  同じ理由で`chairs.updated_at = chairs.updated_at`のガードを付与。
- `chairPostCoordinate`(chair_handlers.ts): 既存の`prevLocation`ありケースの
  `UPDATE chairs SET total_distance = ...`に`latest_latitude`/`latest_longitude`の更新を
  同じ文で追加(**この最高頻度エンドポイントに新規クエリを追加しない**ことを優先)。
  `prevLocation`なしケース(その椅子にとって初回の位置情報送信、椅子ごとに一度きり)のみ、
  新規に軽量な`UPDATE chairs SET latest_latitude = ?, latest_longitude = ? WHERE id = ?`を追加。
- `appGetNearbyChairs`(app_handlers.ts): entries/0020で追加した`chair_locations`への
  GROUP BY集計クエリを削除し、`chair.latest_latitude`/`chair.latest_longitude`を直接参照。
  未送信(`NULL`)の椅子はスキップ。未使用になった`ChairLocation`型のimportも削除。

コミット: `15719fe`(isucon14-webapp側は`git subtree push`で同期済み: `bbb0c7c`)

## 検証

直前(entries/0021)のafter計測をそのままbeforeとして使用(6461 / 6660 / 5967、中央値6461)。

- after: 6127(verboseLogging=true) / 6551 / 6739 → 中央値6551(約+1.4%)

仮説の根拠にした指標(GROUP BY集計クエリの出現回数)を修正前後の生ログで比較したところ、
103回→0回で完全に除去されたことを確認した。整合性についても`chairs.latest_latitude IS NOT NULL`
の件数(387)が位置情報送信済みの椅子数と一致することを確認済み。ただしスコアの伸び幅は+1.4%と
小さく、このクエリ自体の総コスト(全体の4.8%)がそもそも大きくなかったこと、また
`chairPostCoordinate`側にわずかながら更新カラムを追加したコストが相殺している可能性もある。
`chair_locations`はベンチマークが長時間走るほど肥大化する性質のテーブルなので、より長時間の
ベンチマーク(本番相当)ではこの差がより顕著になる可能性がある。
