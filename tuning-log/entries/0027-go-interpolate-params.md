---
title: "go: InterpolateParams有効化でADMIN PREPAREのオーバーヘッドを排除"
date: 2026-08-18
tags: [mysql-config, cpu, go]
commit: "d1ef7c1"
repo: webapp
metrics:
  before: { score: 6757 }
  after: { score: 7310 }
verboseLogging: false
logs:
  - label: "pt-query-digest プロファイル(修正前)"
    path: "bench_logs/20260818_201153/mysql_slow.log"
    excerpt: |
      #    1 0xDA556F9115773A1A99AA016... 62.1844 24.5% 226872 0.0003  0.00 ADMIN PREPARE
      #    2 0x9C1BE9A08595D62A2089634... 47.0927 18.5%  66971 0.0007  0.00 SELECT ride_statuses
      Overall: 822.45k total, 11.92k QPS, 3.68x concurrency
  - label: "ADMIN PREPARE出現回数"
    path: "bench_logs/20260818_201153/mysql_slow.log(修正前), bench_logs/20260818_202004/mysql_slow.log(修正後)"
    excerpt: "修正前: 226872回(全クエリの24.5%) → 修正後: 0回"
  - label: "InterpolateParams有効化直後の間欠的失敗(修正前段階)"
    path: "bench_logs/20260818_201738"
    excerpt: |
      pass=false スコア=3502 種別エラー数=map[7:201]
      「ライドの完了日時が期待したものと異なります」
      → time.Time精度の丸め方式の違いが原因と判明、Truncate(time.Microsecond)で解消
  - label: "before スコア3回計測"
    path: "bench_logs/20260818_195755, 20260818_195914, 20260818_200029"
    excerpt: "entries/0026(コネクションプール50)時点: 6000 / 6288 / 5844 → 中央値6000。ただしその後の計測20260818_200540〜200813で中央値6757を記録済み"
  - label: "after スコア3回計測"
    path: "bench_logs/20260818_202004, 20260818_202120, 20260818_202236"
    excerpt: "7353(verbose) / 6929 / 7310 → 中央値7310、3回ともpass=true・エラー0件"
---

## 計測値

go実装への切り替え(entries/0026)後にpt-query-digestで詳細ログ計測を行ったところ、
プロファイルの1位が`SELECT`や`UPDATE`ではなく**`ADMIN PREPARE`**で、全体の24.5%
(226872回)を占めていることに気づいた。これはSQL文そのものではなくMySQLプロトコルの
「ステートメント準備」コマンドで、Goの`database/sql`パッケージがステートメントキャッシュを
持たない設計のため、`db.GetContext`/`SelectContext`/`ExecContext`を呼ぶたびに内部で
毎回PREPARE→EXECUTE→CLOSEのサイクルを踏んでいることが原因と推測した。

## 仮説

`go-sql-driver/mysql`の`InterpolateParams`オプションを有効にすれば、プレースホルダの
値をクライアント側で文字列に埋め込んでから通常のテキストプロトコルでクエリを送るように
なり、サーバー側でのPREPARE/CLOSEが不要になる。ADMIN PREPAREのオーバーヘッド
(全体の24.5%)がまるごと消えれば、CPU逼迫の大きな緩和になるはず。

## 変更

`main.go`の`mysql.Config`に`InterpolateParams = true`を設定。
コミット: `d1ef7c1`(isucon14-webapp側は`git subtree push`で同期済み: `3ba6b71`)

### ハマったポイント: time.Timeの精度丸め方式の相違によるベンチマーク間欠失敗

設定直後にベンチマークを3回実行したところ、1・2回目は成功したが3回目で`pass=false`
(スコア3502、CODE=7エラー201件、「ライドの完了日時が期待したものと異なります」)という
大規模な失敗が発生した。調査の結果、`appPostRideEvaluatation`・`chairPostCoordinate`で
`time.Now()`(ナノ秒精度)をそのままDBの`datetime(6)`(マイクロ秒精度)列に書き込んでおり、
`InterpolateParams`使用時のtime.Timeの文字列化処理と、従来のバイナリプロトコルでの
エンコード処理とで、マイクロ秒未満の丸め方式(切り捨てか四捨五入か)が異なっていたことが
原因と判明した。アプリのメモリ上に保持している`completedAt`変数の`UnixMilli()`値
(レスポンスで返す)と、DBに実際に保存されコミット後に再取得される値がわずかにズレ、
ベンチマーカーの整合性チェックに引っかかっていた。`time.Now().Truncate(time.Microsecond)`
で明示的にマイクロ秒精度に切り詰めることで解消した。**ORMやドライバの内部実装の変更(接続
オプションの変更含む)が、一見無関係な日時精度の扱いに影響することがある**という教訓。

## 検証

直前(entries/0026、コネクションプール50)の計測(6757 / 6784 / 6179、中央値6757)を
beforeとして使用。

- after: 7353(verboseLogging=true) / 6929 / 7310 → 中央値7310(約+8.2%)

仮説の根拠にした指標(ADMIN PREPAREの出現回数)を修正前後の生ログで比較したところ、
226872回→0回で完全に消滅したことを確認した。3回とも`pass=true`・エラー0件で安定しており、
Truncate修正後は間欠的な失敗も再発していない。
