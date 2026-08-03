---
title: "appGetRidesのchairs/owners個別取得N+1をJOINで解消"
date: 2026-08-03
tags: [n+1, sql]
commit: "a0d695d"
repo: webapp
metrics:
  before: { score: 6551 }
  after: { score: 6247 }
verboseLogging: false
logs:
  - label: "SELECT * FROM owners WHERE id の出現回数"
    path: "bench_logs/20260803_230644/mysql_slow.log(修正前), bench_logs/20260803_231300/mysql_slow.log(修正後)"
    excerpt: "修正前: 46回 → 修正後: 0回(完全に除去)"
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_230644, 20260803_230803, 20260803_230921"
    excerpt: "entries/0022のafter計測をそのままbeforeとして使用: 6127(verbose) / 6551 / 6739 → 中央値6551"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_231300, 20260803_231416, 20260803_231532"
    excerpt: "6158(verbose) / 6500 / 6247 → 中央値6247"
---

## 計測値

entries/0006(過去のセッション)で`appGetRides`の`rides`/`ride_statuses`間のN+1は解消済み
だったが、コードを読み直すと、取得した各rideごとに`SELECT * FROM chairs WHERE id = ?`と
`SELECT * FROM owners WHERE id = ?`をループ内で個別発行する、chairs/owners側のN+1がまだ
残っていた。`SELECT * FROM owners WHERE id`はentries/0021検証時点のログで46回(ユーザーの
ライド履歴件数分)発生していた。

## 仮説

`chairs`・`owners`はrideの`chair_id`から一意に辿れる関係で、`rides`の取得クエリに
`JOIN chairs`・`JOIN owners`を追加すれば1クエリで済む。呼び出し頻度自体は
`appGetNotification`ほど高くないため大きな効果は見込めないが、安全に削れるN+1として対応する。

## 変更

`appGetRides`のSELECT文に`JOIN chairs c ON c.id = r.chair_id`・`JOIN owners o ON o.id = c.owner_id`
を追加し、`c.name AS chair_name`・`c.model AS chair_model`・`o.name AS owner_name`を
一緒に取得。ループ内の個別`SELECT * FROM chairs`・`SELECT * FROM owners`を削除し、
レスポンス組み立てをJOIN結果のフィールドから直接行うよう変更。
コミット: `a0d695d`(isucon14-webapp側は`git subtree push`で同期済み: `2d9ef7a`)

## 検証

直前(entries/0022)のafter計測をそのままbeforeとして使用(6127 / 6551 / 6739、中央値6551)。

- after: 6158(verboseLogging=true) / 6500 / 6247 → 中央値6247(約-4.6%、**悪化**)

仮説の根拠にした指標(`SELECT * FROM owners WHERE id`の出現回数)は修正前46回→修正後0回で
完全に除去を確認できたが、スコアの中央値はむしろ下がった。この変更自体の呼び出し頻度が
もともと低く(46回程度)、削減できるクエリ数の絶対量が小さいため、期待した改善効果は
現れず、before/after双方のブレ幅(6127〜6739、6158〜6500)の中に埋もれてしまったと考えられる。
クエリの削減自体は正しく機能しており、コードとしても悪化する要素はないため変更は維持するが、
「エントリを1つ作るに値するほどの独立した効果があった」とは言えない結果だった。呼び出し頻度の
低い箇所のN+1解消は、このセッションのCPU逼迫状況ではスコアへの寄与が見えにくいという教訓として
記録しておく。
