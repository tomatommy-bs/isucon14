---
title: "ridesにlatest_statusキャッシュ列を追加しgetLatestRideStatus呼び出しを削減"
date: 2026-08-03
tags: [n+1, sql, cache-column, cpu]
commit: "d0a3266"
repo: webapp
metrics:
  before: { score: 4708 }
  after: { score: 4940 }
verboseLogging: false
logs:
  - label: "pt-query-digest (after, verboseLoggingあり参考計測)"
    path: "bench_logs/20260803_002738/mysql_slow.log"
    excerpt: |
      #    1 SELECT ride_statuses (統合クエリ、entries/0012由来) 38328回
      getLatestRideStatus由来の「SELECT status ... ORDER BY created_at DESC LIMIT 1」は
      上位ランクから消滅(修正前は11258回、entries/0014時点の計測 20260803_001026 参照)
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_001026, 20260803_001141, 20260803_001256"
    excerpt: "entries/0014のafter計測をそのままbeforeとして使用: 3555(verbose) / 4708 / 4967 → 中央値4708"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_002623, 20260803_002738, 20260803_002854"
    excerpt: "4940 / 4787(verbose) / 4998 → 中央値4940(3回のブレ幅がこれまでで最も小さい)"
---

## 計測値

entries/0012〜0014で個々の無駄なクエリを削っても、pt-query-digestの上位ランクには依然として
`ride_statuses`関連のSELECTが合計5万回近く残り続けていた。内訳を洗い出すと、`getLatestRideStatus()`
(common.ts、`SELECT status FROM ride_statuses WHERE ride_id = ? ORDER BY created_at DESC LIMIT 1`)が
`chairPostCoordinate`・`appPostRideEvaluatation`・`chairPostRideStatus`(CARRYING分岐)の3箇所で
呼ばれており、entries/0014時点の計測で11258回相当あった。加えて`appGetNearbyChairs`では、
アクティブな椅子ごとに取得した過去のrides全件に対して**ループ内でgetLatestRideStatus()を呼ぶ
N+1**になっていた(この呼び出しはpt-query-digestの上位20位には出ないほど個々のコストは小さいが、
呼び出し構造自体が無駄)。

## 仮説

これら4箇所は全て、呼び出し時点で対象の`ride`レコード自体は既に`SELECT * FROM rides ...`で
取得済みだった。`rides`テーブルに最新ステータスをキャッシュする列を追加し、`ride_statuses`への
INSERTのたびに同じ値で更新しておけば、これら4箇所は追加のSELECTなしで`ride.latest_status`を
そのまま使える。entries/0003(owner/chairsのキャッシュ列)・entries/0013(created_atのアプリ側生成)
と同系統の「既に持っている情報の再取得をやめる」パターン。

## 変更

- `sql/5-latest-ride-status-cache.sql`: `rides`に`latest_status`列(ENUM、DEFAULT 'MATCHING')を追加し、
  既存の`ride_statuses`から最新値をバックフィル。`sql/init.sh`に組み込み(`/api/initialize`のたびに実行される)。
- `ride_statuses`への全INSERT箇所(`chairPostCoordinate`のPICKUP/ARRIVED、`chairPostRideStatus`の
  ENROUTE/CARRYING、`appPostRideEvaluatation`のCOMPLETED)で、同じトランザクション内に
  `UPDATE rides SET latest_status = ? WHERE id = ?`を追加(新規ライド作成時のMATCHINGは列のDEFAULTに任せた)。
- 上記4箇所の`getLatestRideStatus()`呼び出しを、既に取得済みの`ride.latest_status`参照に置き換え。
- 型定義(`types/models.ts`)の`Ride`に`latest_status: string`を追加。

コミット: `d0a3266`(isucon14-webapp側は`git subtree push`で同期済み: `79b3543`)

### ハマったポイント

バックフィルSQLの初回実装で`SET rides.latest_status = latest.status`だけを書いたところ、
`rides.updated_at`が`ON UPDATE CURRENT_TIMESTAMP(6)`付きのため、**この列を明示的に触っていなくても
UPDATEが1つでも走った時点で自動的にバックフィル実行時刻へ書き換わってしまい**、シードデータの
`updated_at`が破壊された。この結果`GET /api/owner/sales`(`updated_at BETWEEN ...`で絞り込む)が
初期データチェックの時点で不一致となり、ベンチが`prepare`段階で即座に失敗した(2回連続で同じ場所で
決定論的に失敗したため、ノイズではなくバグと判断できた)。`SET ..., rides.updated_at = rides.updated_at`
を追加し、自分自身への再代入で自動更新を抑制することで解決。**「触っていないつもりの列」でも
ON UPDATE系のトリガーがある場合は影響を受ける、という点は今後も注意が必要**。

## 検証

直前(entries/0014)のafter計測をそのままbeforeとして使用(3555 / 4708 / 4967、中央値4708)。

- after: 4940 / 4787(verboseLogging=true) / 4998 → 中央値4940(約+4.9%)

仮説の根拠にした指標(`getLatestRideStatus`由来のSELECT呼び出し)を変更後のpt-query-digest出力で
確認したところ、上位20位から完全に消滅していた(修正前11258回→0回相当)。また今回はafter内の
3回のブレ幅(4787〜4998)がこれまでの一連の計測の中で最も小さく、CPU逼迫の緩和が安定性にも
寄与している可能性がある。ただし依然として3回計測のみであり、確定的な結論ではない。
