---
title: "MySQL接続をTCPループバックからUnixソケットに切り替え"
date: 2026-08-03
tags: [mysql-config, cpu]
commit: "1797bd7"
repo: webapp
metrics:
  before: { score: 4950 }
  after: { score: 5144 }
verboseLogging: false
logs:
  - label: "processlist host列(接続方式の確認)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      修正前: SELECT id, host FROM information_schema.processlist WHERE user='isucon' → 127.0.0.1:<port>
      修正後: 同クエリ → localhost (Unixソケット接続時の表示)
      ss -tn state established '( dport = :3306 or sport = :3306 )' | wc -l → 1(ほぼゼロに)
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_003443, 20260803_003558, 20260803_003712"
    excerpt: "entries/0016のafter計測をそのままbeforeとして使用: 4950(verbose) / 5018 / 4604 → 中央値4950"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_004258, 20260803_004414, 20260803_004530"
    excerpt: "5316(verbose) / 5144 / 5087 → 中央値5144(ブレ幅も比較的小さい)"
---

## 計測値

entries/0016(nginx-node間keepalive)は効果が限定的だったため、視点を変えてアプリ<->DB間の
接続方式を確認した。`main.ts`の`createPool`は`host: process.env.ISUCON_DB_HOST || "127.0.0.1"`
としており、DBが同一ホスト(`ISUCON_DB_HOST=127.0.0.1`)であるにもかかわらずTCPループバック経由で
接続していた。TCPループバックはUnixドメインソケットに比べてカーネル内のネットワークスタックを
経由する分オーバーヘッドが大きいことが知られている。

## 仮説

DBが同一ホストの場合、`socketPath`(`/var/run/mysqld/mysqld.sock`)で接続すればTCPスタックを
経由しない分だけCPUオーバーヘッドを削減できる。今回の環境は`ISUCON_DB_HOST=127.0.0.1`固定の
単一ホスト構成であることを`/home/isucon/env.sh`で確認済み。

## 変更

`main.ts`で、`ISUCON_DB_HOST`が`127.0.0.1`または`localhost`の場合は`socketPath`(環境変数
`ISUCON_DB_SOCKET`で上書き可、デフォルト`/var/run/mysqld/mysqld.sock`)を使う接続設定に、
それ以外の場合は従来通り`host`/`port`によるTCP接続にフォールバックする分岐を追加。
DBが別ホストに切り出される構成変更が今後あっても壊れないようにした。
コミット: `1797bd7`(isucon14-webapp側は`git subtree push`で同期済み: `c1acf29`)

## 検証

直前(entries/0016)のafter計測をそのままbeforeとして使用(4950 / 5018 / 4604、中央値4950)。

- after: 5316(verboseLogging=true) / 5144 / 5087 → 中央値5144(約+3.9%)

仮説の根拠にした指標(接続方式)を`information_schema.processlist`で確認したところ、修正前は
`host`列が`127.0.0.1:<port>`(TCP接続)だったのに対し、修正後は`localhost`(Unixソケット接続時の
表示)に変わっていることを確認した。あわせて`ss`でTCP:3306のESTABLISHED接続数を見たところ
ほぼ0になっており、意図通りTCP経由の接続が無くなったことも確認できた。afterのブレ幅
(5087〜5316)も比較的小さく、entries/0015に続いてCPU逼迫の緩和が安定性にも寄与している
可能性がある。
