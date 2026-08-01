---
title: "COMMITオーバーヘッドの原因分析とdurability設定チューニング"
date: 2026-07-29
tags: [mysql-config, commit, fsync, negative-result]
repo: mysql
metrics:
  before:
    score: 2720
    commit_share_pct: 51.5
  after:
    score: 2620
    commit_share_pct: 5.8
logs:
  - label: "pt-query-digest COMMIT単独抽出 (before)"
    path: "bench_logs/20260728_235747/mysql_slow.log"
---

## 計測値

コードを読まず、計測値だけでCOMMIT遅延の原因を切り分けた。

1. `SHOW VARIABLES`: `innodb_flush_log_at_trx_commit=1`・`sync_binlog=1`・`innodb_doublewrite=ON` — COMMIT1回につき最低2回の同期ディスクI/O（redoログ+binlog）が強制される設定
2. `pt-query-digest --filter '$event->{arg} =~ m/^commit$/i'`: Count 21,262回/66秒、median 42μs vs avg 3ms・95%tile 11ms・max 21ms（中央値と平均の乖離が大きい）
3. Query_time distributionのヒストグラム: 10μs峰と1〜10ms峰の**2峰性**（典型的なInnoDBのgroup commit待ち行列のシグネチャ）
4. `Innodb_log_waits = 0`（ログバッファ不足ではないと消去法で確認）

## 仮説

COMMIT遅延はアプリのトランザクション設計の問題ではなく、MySQLのdurability設定（fsync頻度）とディスクI/Oの限界が原因。

## 変更

`/etc/mysql/mysql.conf.d/mysqld.cnf`に追記（`/etc/mysql`を新規git管理化してから変更）:
```
innodb_flush_log_at_trx_commit = 2
sync_binlog = 0
```
`innodb_flush_log_at_trx_commit=2`はmysqldプロセスクラッシュには安全で、OS/電源断の場合のみ直近最大1秒分のCOMMIT済みトランザクションを喪失しうる程度のリスク（テーブル破損は起きない）。

## 検証

- `pt-query-digest`: COMMITの全体シェア51.5%→**5.8%**、1回あたり平均実行時間3ms→**0.09ms**、全クエリ合計実行時間115s→**48s**
- しかし**ベンチスコアは2720→2620と横ばい/微減**。SQLレベルの改善がスコアに直結しなかった
- ハマりどころ: `mysqld`再起動で以前`SET GLOBAL`していたスロークエリログ設定(`slow_query_log`, `long_query_time=0`)が揮発し、直後の計測ログが空になった。`mysqld.cnf`に恒久設定として書き直して解決（`SET GLOBAL`は再起動で消える教訓）
- **後日談（0008参照）**: この「横ばい」は、ベンチマーカーとアプリが同一2vCPUマシンに同居していたことによる測定ノイズだったと判明。ベンチマーカーを別インスタンスに分離した後の再検証で、SQLレベルの改善が正しくスコアに反映されることを確認した
