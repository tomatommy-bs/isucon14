---
title: "chairGetNotificationのuser参照をuser_idキャッシュに置き換え"
date: 2026-08-18
tags: [cache, cpu, go]
commit: "2e97ab8"
repo: webapp
metrics:
  before: { score: 7310 }
  after: { score: 7392 }
verboseLogging: false
logs:
  - label: "pt-query-digestプロファイル(entries/0027時点)"
    path: "bench_logs/20260818_201153/mysql_slow.log"
    excerpt: "#    7 0x98A61FDF32A0B9CE3F4E78D... 10.9571  4.3%  25680 0.0004  0.00 SELECT users"
  - label: "SELECT usersの出現回数"
    path: "bench_logs/20260818_202004/mysql_slow.log(修正前), bench_logs/20260818_203107/mysql_slow.log(修正後)"
    excerpt: "修正前: 該当クエリ確認可能な状態 → 修正後: 0回"
  - label: "before スコア3回計測"
    path: "bench_logs/20260818_202004, 20260818_202120, 20260818_202236"
    excerpt: "entries/0027時点: 7353(verbose) / 6929 / 7310 → 中央値7310"
  - label: "after スコア3回計測"
    path: "bench_logs/20260818_203107, 20260818_203226, 20260818_203343"
    excerpt: "7392(verbose) / 7160 / 7522 → 中央値7392、3回ともpass=true"
---

## 計測値

entries/0027時点のpt-query-digestプロファイルで、`SELECT users`が25680回(全体の4.3%)を
占めていた。呼び出し元は`chairGetNotification`(chair_handlers.go)の
`SELECT * FROM users WHERE id = ? FOR SHARE`で、椅子側の通知ポーリング(高頻度)のたびに
乗客のユーザー情報(氏名表示用)を毎回引いていた。

## 仮説

entries/0025(Node.js)・移植済みのgo版access_tokenキャッシュと同じ理由で、`users`テーブルは
作成後どのコードパスからも更新されない(`grep`で`UPDATE users`が存在しないことを確認済み)。
`access_token`単位のキャッシュとは別に、`id`(user_id)をキーにした同種のキャッシュを
追加すれば、このクエリも排除できる。`FOR SHARE`ロックも、更新されないテーブルに対しては
本来不要だった。

## 変更

`middlewares.go`に`userCacheByID`(`map[string]*User`)を追加し、`appAuthMiddleware`で
access_token単位のキャッシュに登録する際、同じ`*User`ポインタを`user_id`キーでも登録する
ようにした。`getUserByID(ctx, tx, userID)`ヘルパーを新設し、キャッシュヒット時はDBに
一切触れない(ヒットしない場合のみフォールバックでDB問い合わせ、結果をキャッシュに追加)。
`chairGetNotification`の`SELECT ... FOR SHARE`をこのヘルパー呼び出しに置き換えた。
`clearAuthCaches()`にも`userCacheByID`のクリアを追加(既存のPOST /api/initializeでの
呼び出しは変更不要)。

コミット: `2e97ab8`(isucon14-webapp側は`git subtree push`で同期済み: `62d3b16`)

### 余談: ディスク容量不足によるベンチマーク大量失敗

この変更を最初にデプロイして計測した際、CODE=1エラーが247件発生し`pass=false`(スコア3502)
という結果になった。調査したところ原因はこの変更とは無関係で、**appサーバーのディスク容量が
100%に達していた**ことによるもの(過去のセッションで積み重なった`bench_logs`が93回分・4.3GB
蓄積していた)。tuning-logのエントリが参照している28回分のログのみ残し、残り65回分を削除して
容量を確保(19GB中1.8GB空きまで回復)したところ、同じコードで問題なくpass=trueになった。
**予期しない大量エラーが出た際は、コードの変更内容だけでなくディスク使用量等の環境要因も
併せて疑うべき**という教訓。

## 検証

直前(entries/0027)の計測をそのままbeforeとして使用(7353 / 6929 / 7310、中央値7310)。

- after: 7392(verboseLogging=true) / 7160 / 7522 → 中央値7392(約+1.1%)

仮説の根拠にした指標(`SELECT users`の出現回数)を確認したところ、該当クエリは修正後の
生ログから消滅していた。スコアの伸びはentries/0025(Node.js版の同種最適化)ほど大きくは
なかったが、これはentries/0027(InterpolateParams)適用後で既にmysqld側のオーバーヘッドの
多くが解消されており、削減余地自体が相対的に小さくなっていたためと考えられる。
