---
title: "認証ミドルウェアのaccess_token→行をインメモリキャッシュ化"
date: 2026-08-18
tags: [cache, cpu, auth]
commit: "92473be"
repo: webapp
metrics:
  before: { score: 6247 }
  after: { score: 6688 }
verboseLogging: false
logs:
  - label: "WHERE access_token の出現回数"
    path: "bench_logs/20260803_231300/mysql_slow.log(修正前), bench_logs/20260818_193834/mysql_slow.log(修正後)"
    excerpt: "修正前: 49504回(全クエリの約13%) → 修正後: 132回"
  - label: "整合性チェック(/api/initialize後)"
    path: "サーバー上でリアルタイム確認"
    excerpt: "POST /api/initialize後にGET /api/owner/salesが正常なレスポンスを返すことを確認(キャッシュがclearAuthCaches()で正しく破棄されている)"
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_231300, 20260803_231416, 20260803_231532"
    excerpt: "entries/0023時点の計測: 6158(verbose) / 6500 / 6247 → 中央値6247"
  - label: "after スコア3回計測"
    path: "bench_logs/20260818_193834, 20260818_193951, 20260818_194106"
    excerpt: "6752(verbose) / 6688 / 7333 → 中央値6688"
---

## 計測値

pt-query-digestの呼び出し回数ランキングを見直したところ、`SELECT * FROM users/chairs/owners
WHERE access_token = ?`(各authミドルウェアが全認証済みリクエストで発行)が合計49504回と、
全クエリ(383k)の約13%を占めていた。

## 仮説

`appAuthMiddleware`・`chairAuthMiddleware`・`ownerAuthMiddleware`が引く`users`/`chairs`/`owners`の
行は、`access_token`をキーに一意に定まり、かつ識別情報(`id`・`access_token`・氏名等)は
作成後どのコードパスからも更新されない(`grep`で確認済み。`chairs.is_active`のみ変化するが、
認証結果からこの値を参照している箇所は無い)。したがって、一度引いた行を`access_token`キーで
プロセス内にキャッシュしても安全なはずで、2回目以降の同一トークンによるリクエストはDB問い合わせ
なしに処理できる。

## 変更

`middlewares.ts`に`Map<string, Row>`のキャッシュを3テーブル分追加し、各authミドルウェアで
「キャッシュにあればそれを使い、無ければDBに問い合わせてキャッシュに格納」という
cache-asideパターンを実装。`POST /api/initialize`はDBを丸ごとリセットするため、
`main.ts`の`postInitialize`ハンドラで`init.sh`実行直後に`clearAuthCaches()`を呼び、
キャッシュを必ず破棄するようにした(これを忘れるとDBリセット後も古いaccess_token→行の
対応が残り、削除されたはずのユーザーで認証が通ってしまう等の不整合が起きる)。

コミット: `92473be`(isucon14-webapp側は`git subtree push`で同期済み: `c18ed7b`)

### セッション中断からの再開について

この変更はコード自体は前回セッション(2026-08-03)で実装・サーバーへのデプロイまで完了していたが、
ベンチマークでの検証前にEC2インスタンス(app/bench共に)が停止し、約2週間中断していた。
再開時にElastic IPが両インスタンスから未アソシエートの状態になっていたため、
`aws ec2 associate-address`で再アソシエートしてから接続を回復した。DBスキーマ・
サーバー上のコードは前回終了時の状態のまま保持されており、ローカルの未コミット差分と
完全一致していたため、そのまま検証を継続できた。

## 検証

直前(entries/0023、gzipの実験であるentries/0024は結局gzip onに戻したため差分なし)の
計測をそのままbeforeとして使用(6158 / 6500 / 6247、中央値6247)。

- after: 6752(verboseLogging=true) / 6688 / 7333 → 中央値6688(約+7.1%)

仮説の根拠にした指標(`WHERE access_token`の出現回数)を修正前後の生ログで比較したところ、
49504回→132回まで削減されたことを確認した。このセッションで検出したクエリ削減の中でも
特に絶対量が大きかった箇所であり、node側のCPU負荷緩和にも寄与したと考えられる。
