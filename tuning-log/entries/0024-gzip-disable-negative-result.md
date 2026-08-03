---
title: "gzip無効化を試したが悪化、元に戻した(negative result)"
date: 2026-08-03
tags: [nginx, negative-result]
metrics:
  before: { score: 6247 }
  after: { score: 5802 }
verboseLogging: false
logs:
  - label: "nginx access.log size平均(参考、entries/0016検証時点)"
    path: "bench_logs/20260803_003712/nginx_access.log"
    excerpt: "count=54383 avg=1001.22 total_MB=51.927"
  - label: "before(gzip on)スコア3回計測"
    path: "bench_logs/20260803_231300, 20260803_231416, 20260803_231532"
    excerpt: "entries/0023のafter計測をそのままbeforeとして使用: 6158(verbose) / 6500 / 6247 → 中央値6247"
  - label: "gzip off スコア3回計測"
    path: "bench_logs/20260803_232046, 20260803_232206, 20260803_232323"
    excerpt: "5680(verbose) / 6712 / 5802 → 中央値5802"
  - label: "元に戻した後(gzip on)の確認計測1回"
    path: "bench_logs/20260803_232505"
    excerpt: "6290(entries/0023時点の水準に近い値であることを確認)"
---

## 計測値

entries/0022検証時点でpidstatを見ると、node(平均91.7%)がmysqld(平均80.3%)より
相対的にボトルネックであり続けていた。nginxのアクセスログサイズ平均が約1KB(entries/0016時点の
計測、51.9MB/54383リクエスト)と小さいことから、gzip圧縮のCPUコスト(圧縮処理そのもの)が、
これだけ小さなペイロードでは転送量削減の利益を上回っているのではないかという仮説を立てた。

## 仮説

`gzip off`にすれば、nginxワーカー(1コアあたり数%程度で軽量とはいえ)の圧縮処理コストが無くなり、
若干ながらCPU全体の余裕が生まれてスコアが向上するはず。小さなJSONペイロードでは圧縮率も
高くなく、転送量削減の恩恵が薄いと推測した。

## 変更

`etc/nginx/nginx.conf`の`gzip on;`を`gzip off;`に変更し、`nginx -t`→`systemctl reload nginx`で反映。

## 検証

直前(entries/0023)のafter計測をそのままbeforeとして使用(6158 / 6500 / 6247、中央値6247)。

- gzip off: 5680(verboseLogging=true) / 6712 / 5802 → 中央値5802(約-7.1%、**悪化**)

想定とは逆の結果になった。考えられる要因として、gzip圧縮を無効化した分レスポンスの
生バイト数が増え、ベンチマーカーとの通信(2台構成でネットワーク越し)における転送時間・
帯域の方が、nginx側の圧縮CPUコストより支配的だった可能性がある。nginx自体のCPU使用率は
そもそも平均5%台と小さく、gzip処理そのものの削減余地も限られていた。

**結論**: 仮説は誤りと判断し、`gzip on`に戻した(確認のため1回追加計測し、6290と
entries/0023時点の水準に近い値であることを確認)。差分としてはコミットするものがない
(元の状態に戻したため)。「レスポンスが小さいから圧縮は無駄」という直感は、2台構成で
ネットワーク越しにベンチマークする環境では必ずしも成り立たないという教訓を記録しておく。
