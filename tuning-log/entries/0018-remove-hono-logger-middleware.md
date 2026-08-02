---
title: "hono/loggerミドルウェアの削除(これまでで最大の改善)"
date: 2026-08-03
tags: [logging, cpu, nodejs]
commit: "fbc816e"
repo: webapp
metrics:
  before: { score: 5144 }
  after: { score: 6475 }
verboseLogging: false
logs:
  - label: "pidstat平均%CPU(ベンチ実行中、40サンプル)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      削除前(entries/0017適用後): mysqld 73.59% / node 88.03% / nginx(1worker) 5.13%
      削除後: mysqld 84.16% / node 88.38% / nginx(1worker) 5.72%
      (node自体の%CPUはほぼ同じだが、後述の通りスコア・スループットは大きく向上。
       同じCPU使用率でより多くの有効なリクエスト処理に充てられるようになったと解釈)
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_004258, 20260803_004414, 20260803_004530"
    excerpt: "entries/0017のafter計測をそのままbeforeとして使用: 5316(verbose) / 5144 / 5087 → 中央値5144"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_005016, 20260803_005131, 20260803_005246"
    excerpt: "5833(verbose) / 6475 / 6501 → 中央値6475"
---

## 計測値

entries/0017適用後もCPUは逼迫したままで、`pidstat -u 1`ではmysqld 73.6%・node 88.0%と、
nodeが2vCPU中1コア近くを使い切っていた。`main.ts`を読み直すと、`app.use(logger())`
(`hono/logger`)が全リクエストに対してアクセスログを標準出力へ書き出す構成になっていた。
ベンチマーク実行中、このログを人間がリアルタイムで見ることはなく、`journalctl`等に
溜まり続けるだけの純粋なオーバーヘッドだった。

## 仮説

`hono/logger`はリクエストごとに文字列組み立てと`console.log`(実体は同期的な書き込みを伴う)を
行うため、特に高頻度なポーリング系エンドポイントでリクエスト数に比例したCPU/IOコストが
蓄積していると考えた。これを削除すればnodeのCPU使用率に余裕が生まれ、スループット(ひいては
スコア)が向上するはず。

## 変更

`main.ts`から`app.use(logger());`と対応する`import { logger } from "hono/logger";`を削除。
コミット: `fbc816e`(isucon14-webapp側は`git subtree push`で同期済み: `84686dc`)

## 検証

直前(entries/0017)のafter計測をそのままbeforeとして使用(5316 / 5144 / 5087、中央値5144)。

- after: 5833(verboseLogging=true) / 6475 / 6501 → 中央値6475(約+25.9%、これまでの一連の
  改善の中で最大の伸び幅)

仮説の根拠にした指標としてpidstatで前後のCPU使用率を比較したところ、node自体の平均%CPU
(88.0%→88.4%)はほとんど変わっていなかった。これは一見「効果が無かった」ようにも見えるが、
実際にはベンチのスコア・処理件数(request数)が大きく増えている(=同じ70秒間でより多くの
リクエストを捌けている)ため、**同じCPU使用率でもログ出力ではなく実際のリクエスト処理に
CPU時間が使われるようになった**と解釈するのが妥当。CPU使用率という指標だけでは効果を
正しく読み取れず、スループット(スコア)と併せて見る必要があった点は今後の教訓にしたい。

なお、mysqldの平均%CPUはむしろ増加(73.6%→84.2%)している。これはnode側の処理が速くなった分
DBへのリクエスト頻度自体が上がり、mysqldの絶対的な負荷が増えたためと考えられる。ボトルネックが
node側からmysqld側へ相対的にシフトしつつあるため、次はMySQL側のCPU使用率削減(クエリ自体の
軽量化やコネクション設定)を検討したい。
