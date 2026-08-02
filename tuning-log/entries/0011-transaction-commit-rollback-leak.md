---
title: "早期returnによるトランザクションcommit/rollback漏れの修正"
date: 2026-08-02
tags: [transaction, mysql-config, bugfix, connection-pool]
commit: "1f8acd7"
repo: webapp
metrics:
  before: { score: 3905 }
  after: { score: 4322 }
verboseLogging: false
logs:
  - label: "pt-query-digest (before, verboseLoggingあり参考計測)"
    path: "bench_logs/20260802_102404/mysql_slow.log"
    excerpt: |
      # Profile
      # Rank Query ID                      Response time Calls R/Call V/M   Item
      #    1 0xDCA6B16A0FC65C799EB401CB...  6.2380 12.6% 29394 0.0002  0.00 SELECT ride_statuses
      #    2 0xD8DAD8AC6EDE2238F17AC39B...  4.8144  9.7% 21913 0.0002  0.00 SELECT rides
      #    4 0xFFFCA4D67EA0A788813031B8...  3.1087  6.3% 28033 0.0001  0.00 COMMIT
      #   17 0xFFF66E9B3D962FA319C8068B...  1.1427  2.3% 32702 0.0000  0.00 ROLLBACK
  - label: "before スコア3回計測"
    path: "bench_logs/20260802_102404, 20260802_103021, 20260802_103135"
    excerpt: "3885 (verbose) / 3905 / 4912"
  - label: "after スコア3回計測"
    path: "bench_logs/20260802_103537, 20260802_103652, 20260802_103806"
    excerpt: "3956 (verbose) / 5086 / 4322"
---

## 計測値

`-v`付きでベースライン計測を行い、`pt-query-digest`でMySQLスロークエリログ(`long_query_time=0`で全件記録)を解析。
クエリ自体は1回あたり平均169us/95%tile 424usと軽量で、インデックスも既存(`idx_ride_id_created_at`等)で妥当。
一方、profileのCOMMIT(28033回)に対し**ROLLBACK(32702回)が上回っている**のが不自然な数値として目に付いた。

コード側を`beginTransaction()`〜`commit()`/`rollback()`の対応関係で機械的に洗い出すと、
`try`節内の早期`return`で**どちらも呼ばずに関数を抜けているパス**が複数の高頻度エンドポイントに存在した:

- `appGetNotification`(app_handlers.ts): ライド未存在時の`return ctx.json({retry_after_ms:30})`(ポーリングで最頻)
  加えて`beginTransaction()`の呼び出しに`await`が無く、後続クエリと競合しうる状態だった
- `chairGetNotification`(chair_handlers.ts): 同様にライド未存在時の早期return(ポーリングで最頻)
- `chairPostRideStatus`: ride not found / not assigned / chair has not arrived yet / invalid status の4分岐
- `appPostRideEvaluatation`: ride not found(2箇所) / not arrived yet / payment token not registered の4分岐
  (`UPDATE rides SET evaluation`後の分岐もあり、コミット漏れのまま接続がプールに返却されるとUPDATE/INSERTが
  宙に浮いた状態になりうる)
- `appPostUsers`: 招待コード関連の2分岐(`SELECT ... FOR UPDATE`でロックを取得した直後の早期return)
- `appPostRides`: `ride already exists`の早期return
- `ownerGetSales`: そもそも**正常終了パスでcommit()を一度も呼んでいない**(catch節のrollback()のみ実装)

## 仮説

mysql2のコネクションプールでは、`beginTransaction()`後に`commit()`/`rollback()`のどちらも呼ばずに
コネクションをプールへ返却すると、そのコネクションはトランザクション未終了(autocommit OFF)のまま
次のリクエストに再利用される。特に`FOR UPDATE`/`FOR SHARE`でロックを取得した経路(`appPostUsers`の招待コード、
`chairPostRideStatus`の`SELECT ... FOR UPDATE`)でこれが起きると、ロックが解放されないまま次のトランザクションに
持ち越され、他リクエストのロック待ち・タイムアウトを引き起こす可能性がある。ベンチ実行時に散発する
`POST /api/app/rides/{ride_id}/evaluation`の502エラーや、ベースライン3回の計測(3885/3905/4912)のばらつきの大きさは、
この未解放ロックによる不安定な挙動と整合する。

## 変更

該当する全ての早期return箇所に、分岐の性質に応じて`commit()`(正常系で書き込み確定が必要な場合)または
`rollback()`(異常系・書き込み未確定のまま中断する場合)を追加。`appGetNotification`の`beginTransaction()`にも`await`を追加。
コミット: `1f8acd7`(isucon14-webapp側は`git subtree push`で同期済み: `d8b3dd1`)

対象ファイル: `app_handlers.ts`, `chair_handlers.ts`, `owner_handlers.ts`

## 検証

不安定さがあるため、ユーザーの指示で before/after 各3回計測して比較した。

- before: 3885(verboseLogging=true, ボトルネック解析用) / 3905 / 4912 → 中央値 3905
- after:  3956(verboseLogging=true) / 5086 / 4322 → 中央値 4322

中央値ベースで約+10.7%のスコア向上。エラー件数も安定して減少傾向(before各回の種別エラー数=4/2/3、
after=1/0/5)。ただし依然としてブレ幅は大きく(after内でも3956〜5086)、今回の修正だけで
不安定さが完全に解消したとは言えない。ロック競合以外にも変動要因(GC、ネットワーク揺らぎ等)が
残っている可能性があり、次回はロック待ち時間そのもの(`SHOW ENGINE INNODB STATUS`や
`performance_schema`)を計測して裏付けを取りたい。

### 追記: COMMIT/ROLLBACK比率について

修正後の`-v`計測(`20260802_103537`)を同様に`pt-query-digest`で解析したところ、
COMMIT=29014・ROLLBACK=35586(比率1.23倍)で、修正前(COMMIT=28033・ROLLBACK=32702、比率1.17倍)より
**むしろ差が広がった**。これは「仮説」節で根拠にした不自然さが解消されていないことを意味するのではなく、
指標の解釈が誤っていたことを示す。修正前は早期return箇所の一部がcommit()/rollback()どちらも
呼ばずに抜けており、それらのリクエストはこの集計に一切現れていなかった(サイレントリーク)。
修正後は同じ箇所が明示的にrollback()を呼ぶようになったため、新たにROLLBACK文がカウントされるように
なった分だけ増加している(START総数はbefore=32314→after=32105とほぼ変化なし、COMMIT+ROLLBACK合計は
before=60735→after=64600)。

このアプリはアクティブなライドが無い状態でのポーリング(通知確認)が多く、その場合は早期return
(=rollback)で終わるのが正常系のため、ROLLBACKがCOMMITを上回ること自体は自然な挙動であり、
「バグがあるかどうか」を直接示す指標ではなかった。バグの有無はコード上で全てのbeginTransaction()が
commit()/rollback()いずれかで確実に閉じられているかを機械的に確認する必要があり、そちらは修正時に
grepで全箇所確認済み(app_handlers.ts / chair_handlers.ts / owner_handlers.ts)。
