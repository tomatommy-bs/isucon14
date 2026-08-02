---
title: "MySQLバイナリログの無効化(結果は不確定)"
date: 2026-08-03
tags: [mysql-config, negative-result, disk]
commit: "156039b"
repo: etc
metrics:
  before: { score: 6475 }
  after: { score: 5971 }
verboseLogging: false
logs:
  - label: "SHOW BINARY LOGS(変更前)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      binlog.000019〜000023が存在、うち複数が100MB超(max_binlog_size=100M到達分)
      → これまでの複数回のベンチ実行・/api/initializeの繰り返しで蓄積し続けていたことを示す
  - label: "pidstat平均%CPU(ベンチ実行中、40サンプル)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      無効化前(entries/0018適用後): mysqld 84.16% / node 88.38%
      無効化後: mysqld 81.46% / node 90.83%
      (mysqldは約2.7ポイント減、nodeは約2.4ポイント増。合計CPU使用率はほぼ変わらず)
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_005016, 20260803_005131, 20260803_005246"
    excerpt: "entries/0018のafter計測をそのままbeforeとして使用: 5833(verbose) / 6475 / 6501 → 中央値6475"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_005839, 20260803_005954, 20260803_010109"
    excerpt: "5567(verbose) / 6576 / 5971 → 中央値5971"
---

## 計測値

entries/0018でnode側のCPUオーバーヘッドを削減した結果、mysqld側の負荷比率が相対的に
上がっていた(entries/0018検証時点でmysqld平均84.2%)。MySQLの設定を見直したところ、
`/etc/mysql/mysql.conf.d/mysqld.cnf`に`log_bin`の明示指定が無いにもかかわらず
`SHOW VARIABLES LIKE 'log_bin'`が`ON`を返しており、`SHOW BINARY LOGS`では複数の
100MB超のbinlogファイルが蓄積していた。MySQL 8はバイナリログがデフォルトで有効なため、
書き込みクエリのたびにbinlogへの追記コストが発生していると考えられる。

## 仮説

このISUCON環境はレプリケーションもポイントインタイムリカバリも行わない単一ノード構成のため、
バイナリログは不要かつ純粋なオーバーヘッド。`disable_log_bin`を設定すれば、書き込みクエリの
たびのI/Oコストが減り、mysqldのCPU使用率が下がってスコアが向上するはず。またディスク容量
圧迫(以前から懸念していた5.3GB/19GB)の緩和にも寄与するはず。

## 変更

`etc/mysql/mysql.conf.d/mysqld.cnf`に`disable_log_bin`を追加し、`sudo systemctl restart mysql`で反映。
`SHOW VARIABLES LIKE 'log_bin'`が`OFF`になったことを確認済み。
コミット: `156039b`(isucon14-etc側への同期は、entries/0016と同じ既存の分岐要因で
`git subtree push`が`rejected`となり未実施)

## 検証

直前(entries/0018)のafter計測をそのままbeforeとして使用(5833 / 6475 / 6501、中央値6475)。

- after: 5567(verboseLogging=true) / 6576 / 5971 → 中央値5971(約-7.8%、**改善ではなく悪化**)

仮説の根拠にした指標(pidstatによるmysqld平均%CPU)は変更前84.16%→変更後81.46%と、
仮説通り小さく下がったことを確認できた。しかしスコアの中央値はむしろ下がっており、
CPU使用率の指標と実際のスコアの向きが一致しなかった。before/afterともに3回計測の
レンジが大きく重なっており(before 5833〜6501、after 5567〜6576)、この規模のブレの中では
どちらが「真の効果」かを断定できない。

**結論**: `disable_log_bin`自体はCPU使用率をわずかに下げる効果が確認でき、副次的に
ディスク使用量の増加ペースを緩めるメリットもあるため変更は維持するが、**スコア向上効果は
実証できなかった**(むしろ悪化して見える計測結果だった)。CPU使用率の改善が必ずしも
スコアに直結しない例(entries/0018の逆パターン)であり、「指標は動いたがスコアは動かない/
悪化する」ケースも正直に記録しておく。次回以降、この変更の効果をより正確に見るには
3回よりも多い回数の計測が必要かもしれない。
