---
title: "nginx-node間keepalive・access_logバッファリング(効果限定的)"
date: 2026-08-03
tags: [nginx, negative-result]
commit: "1d1027e"
repo: etc
metrics:
  before: { score: 4940 }
  after: { score: 4950 }
verboseLogging: false
logs:
  - label: "TIME_WAIT接続数(ベンチ実行中、dport/sport=8080)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      ss -tn state established '( dport = :8080 or sport = :8080 )' | wc -l → 117
      ss -tn state time-wait   '( dport = :8080 or sport = :8080 )' | wc -l → 114
      (keepalive設定後も大量のTIME_WAITが発生しており、コネクション再利用が
       十分に効いていない可能性が高い)
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_002623, 20260803_002738, 20260803_002854"
    excerpt: "entries/0015のafter計測をそのままbeforeとして使用: 4940 / 4787(verbose) / 4998 → 中央値4940"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_003443, 20260803_003558, 20260803_003712"
    excerpt: "4950(verbose) / 5018 / 4604 → 中央値4950"
---

## 計測値

entries/0015までの一連の修正でDBラウンドトリップを減らしてきた流れで、次はnginx層を見た。
`/etc/nginx/sites-available/isuride.conf`の`location /api/`が`proxy_pass http://localhost:8080;`
のみで、nginx<->node間の`upstream`ブロック・`keepalive`指定が無かった。デフォルトでは
`proxy_pass`はリクエストのたびにアップストリームへ新規TCPコネクションを張るため、localhost間とはいえ
コネクション確立・TIME_WAIT処理のオーバーヘッドが積み重なっている可能性を疑った。

## 仮説

`upstream`ブロックに`keepalive 32;`を設定し、`proxy_http_version 1.1;`+
`proxy_set_header Connection "";`を合わせて指定すれば、nginx<->node間のTCPコネクションが
再利用され、コネクション確立コストとTIME_WAIT接続の蓄積が減る。CPU逼迫の緩和に寄与するはず。
併せて`access_log`に`buffer=32k flush=5s`を追加し、リクエストごとの同期書き込みをまとめる。

## 変更

`etc/nginx/nginx.conf`に`upstream app_backend { server 127.0.0.1:8080; keepalive 32; }`を追加し、
`access_log`に`buffer=32k flush=5s`を追加。`etc/nginx/sites-available/isuride.conf`の
`location /api/`・`location /api/internal/`双方の`proxy_pass`を`http://app_backend;`に変更し、
`proxy_http_version 1.1;`・`proxy_set_header Connection "";`を追加。
コミット: `1d1027e`(isucon14-etc側への同期は、既存の別要因によるブランチ分岐で`git subtree push`が
`rejected`となり未実施。次回のetc同期時に解消する)

## 検証

直前(entries/0015)のafter計測をそのままbeforeとして使用(4940 / 4787 / 4998、中央値4940)。

- after: 4950(verboseLogging=true) / 5018 / 4604 → 中央値4950(ほぼ変化なし、+0.2%)

仮説の根拠にした指標を確認するため、ベンチ実行中に`ss`でnginx<->node間(ポート8080)の接続状態を
見たところ、ESTABLISHED 117・TIME_WAIT 114と、**keepalive設定後も大量のTIME_WAITが発生しており、
コネクション再利用が意図通りには効いていない**ことを確認した。原因は未特定(node側の
`@hono/node-server`のkeepAliveTimeoutが短い、`keepalive 32`が1ワーカーあたりの上限で
ベンチの同時接続数がそれを上回っている、等の可能性がある)。

**結論**: nginx設定自体はエラーなく反映され(`nginx -t`成功、`nginx -T`で反映確認済み)、スコアの
悪化も無かったため変更自体は残すが、狙った「コネクション再利用によるオーバーヘッド削減」という
仮説的効果は実測できなかった。localhost間の通信はそもそもTCPハンドシェイクのコストが小さく
(同一マシン内でネットワークRTTが実質ゼロ)、そもそも改善余地が小さかった可能性がある。

また、今回は「keepalive設定」と「access_logバッファリング」という2つの変更を1コミットに
まとめてしまった。どちらも安全側の変更で個別に切り分ける必要性は薄いと判断したが、
`isucon-tuning`スキルで謳っている「1サイクル1変更」の原則には反しており、それぞれの
個別効果(特にaccess_logバッファリングの効果)は本来切り分けて計測すべきだった。
