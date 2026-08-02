---
title: "通知ポーリングのride_statuses取得を1クエリに統合"
date: 2026-08-03
tags: [n+1, polling, sql, cpu]
commit: "7ffa794"
repo: webapp
metrics:
  before: { score: 3676 }
  after: { score: 4204 }
verboseLogging: false
logs:
  - label: "pidstat(ベンチ実行中のCPU使用率)"
    path: "手元確認のみ(サーバー上でリアルタイム実行、ログファイルとしては保存していない)"
    excerpt: |
      mysqld: %CPU 平均76.45(usr63.47+sys12.97), 一貫してCPU0
      node  : %CPU 平均84前後, CPU0/CPU1を往復
      2コア中この2プロセスだけでほぼ食い潰している状態
  - label: "pt-query-digest (after, verboseLoggingあり参考計測)"
    path: "bench_logs/20260802_235555/mysql_slow.log"
    excerpt: |
      #    1 0x9C1BE9A08595D62A20896346...  8.5173 16.8% 37676 0.0002  0.00 SELECT ride_statuses
      #    6 0xDCA6B16A0FC65C799EB401CB...  2.4808  4.9% 11423 0.0002  0.00 SELECT ride_statuses
      (統合クエリ37676回 + 他ハンドラのgetLatestRideStatus由来11423回 = 49099回。
       修正前は56571回相当(entries/0011のafter計測 20260802_103537 より))
  - label: "before スコア3回計測"
    path: "bench_logs/20260802_235035, 20260802_235555(旧コードでの直近計測ではないため参考値), 20260802_235827"
    excerpt: "この変更直前の直近3計測: 4231 / 3145 / 3676(中央値3676)"
  - label: "after スコア3回計測"
    path: "bench_logs/20260802_235555, 20260802_235712, 20260802_235827"
    excerpt: "4203(verbose) / 4604 / 3354 → 中央値4204"
---

## 計測値

entries/0011で「commit/rollback漏れ」という仮説が誤りだったと判明した後、改めてCPU使用率を
`pidstat -u 1`でベンチ実行中に確認した。2vCPUのうち`mysqld`が平均76%(ほぼCPU0に固定)、
`node`が平均84%前後(CPU0/1を往復)と、この2プロセスだけでほぼ2コアを使い切っている状態だった。
DBのデータサイズは11.4MBとbuffer_pool_size(128MB)に対して十分小さく、インデックス起因のフルスキャンも
見当たらないため、「クエリが遅い」のではなく「クエリの絶対量が多い」ことがCPU逼迫の主因と推測した。

pt-query-digestの呼び出し回数ランキングでは、`ride_statuses`テーブルへのSELECTが複数の異なる
クエリ文で合計5万回超と突出していた。うち`appGetNotification`/`chairGetNotification`
(ポーリング系の最頻エンドポイント)では、1回のポーリングにつき

1. `SELECT ... WHERE ride_id = ? AND app_sent_at(chair_sent_at) IS NULL ORDER BY created_at ASC LIMIT 1`
2. (1が空なら)`getLatestRideStatus`による`SELECT status ... ORDER BY created_at DESC LIMIT 1`

と、最大2回のSELECTを直列に発行していた。

## 仮説

対象rideのステータス履歴は最大でも6件程度(MATCHING〜COMPLETEDの状態遷移分)であり、
`ride_id`で全件取得しても1回のクエリで済む。2回に分けて往復する代わりに全件を1回で取得し、
JS側で「未送信のものがあればそれ、無ければ最後の行」を判定すれば、ポーリングの最頻エンドポイントで
DBラウンドトリップを削減できる。呼び出し頻度が非常に高いため、1回あたりの削減が小さくても
累積では無視できない差になるはず。

## 変更

`appGetNotification`(app_handlers.ts)・`chairGetNotification`(chair_handlers.ts)双方で、
`WHERE ... IS NULL ORDER BY ... LIMIT 1`+条件付きフォールバックの2クエリを、
`WHERE ride_id = ? ORDER BY created_at ASC`(LIMITなし、全件取得)の1クエリに統合し、
`Array.prototype.find`で未送信ステータスを、末尾要素で最新ステータスを判定するよう変更。
コミット: `7ffa794`(isucon14-webapp側は`git subtree push`で同期済み: `7f88e82`)

## 検証

直前の3回計測(4231 / 3145 / 3676、中央値3676)を before として比較。

- after: 4203(verboseLogging=true) / 4604 / 3354 → 中央値4204(約+14.4%)

仮説の根拠にした指標(ride_statuses関連クエリの総呼び出し回数)を変更後に取り直したところ、
修正前の56571回相当(entries/0011のafter計測時点)に対し、修正後は49099回(統合クエリ37676回+
他ハンドラのgetLatestRideStatus由来11423回)に減少しており、狙い通りクエリ数が減っていることを確認した。
ただしスコアの分散は依然として大きく(after内でも3354〜4604)、この規模のブレを持つ環境では
3回計測でも「はっきり効果がある」と言い切るには心もとない。次はCPU使用率そのもの(pidstatのログを
ファイルとして保存し、before/afterで比較できる形にする)を before/after で定量比較したい。
