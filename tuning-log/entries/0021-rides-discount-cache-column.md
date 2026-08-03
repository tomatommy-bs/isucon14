---
title: "rides.discountキャッシュ列を追加しcoupons.used_by再計算を排除"
date: 2026-08-03
tags: [n+1, sql, cache-column, cpu]
commit: "76e9078"
repo: webapp
metrics:
  before: { score: 6176 }
  after: { score: 6461 }
verboseLogging: false
logs:
  - label: "SELECT * FROM coupons WHERE used_by の出現回数"
    path: "bench_logs/20260803_010558/mysql_slow.log(修正前), bench_logs/20260803_225449/mysql_slow.log(修正後)"
    excerpt: "修正前: 13995回 → 修正後: 0回(完全に除去)"
  - label: "整合性チェック(バックフィル後)"
    path: "サーバー上でリアルタイム確認、ログファイル未保存"
    excerpt: |
      SELECT COUNT(*) FROM rides WHERE discount > 0 → 332
      SELECT COUNT(*) FROM coupons WHERE used_by IS NOT NULL → 332
      (一致を確認。GET /api/owner/salesも正常なレスポンスを返すことを確認)
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_010558, 20260803_010714, 20260803_010829"
    excerpt: "entries/0020のafter計測をそのままbeforeとして使用: 6176(verbose) / 5845 / 6825 → 中央値6176"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_225449, 20260803_225607, 20260803_225723"
    excerpt: "6461(verbose) / 6660 / 5967 → 中央値6461"
---

## 計測値

pt-query-digestの呼び出し回数ランキングを改めて見直したところ、`SELECT * FROM coupons
WHERE used_by = ?`が13995回と非常に多いことに気づいた。呼び出し元を`calculateDiscountedFare()`
(common.ts→app_handlers.ts)まで辿ると、`ride`(既存ライド)を渡す全ての呼び出し箇所
(`appGetRides`のループ内、`appPostRideEvaluatation`、そして**ポーリング系最頻エンドポイントの
`appGetNotification`**)で、呼ばれるたびに`coupons`テーブルへの問い合わせが発生していた。

## 仮説

`coupons.used_by`は`appPostRides`でライド作成時に一度だけ`UPDATE coupons SET used_by = ?`
される値で、以後どのコードパスからも更新されない(全体を`grep`して確認済み)。つまり、
あるライドに適用された割引額はライド作成時点で確定し、以後変化しない不変値。にもかかわらず
`appGetNotification`は毎回のポーリングでこの「変化しない値」を再度クエリしていた。
`rides`テーブルに割引額をキャッシュする列を追加すれば、既にrideを取得済みの箇所では
追加クエリなしに割引後運賃を計算できる。

## 変更

- `sql/6-rides-discount-cache-column.sql`: `rides`に`discount`列(INTEGER, DEFAULT 0)を追加し、
  `coupons.used_by`から逆引きしてバックフィル。entries/0015の教訓通り、`ON UPDATE
  CURRENT_TIMESTAMP(6)`の誤発火を防ぐため`rides.updated_at = rides.updated_at`を明示。
- `common.ts`: `calculateDiscountedFareForRide(ride)`を新設(DBアクセスなしで
  `ride.discount`から直接計算)。未使用になっていた`getLatestRideStatus`(entries/0015で
  呼び出し元が全て置き換わり、以後どこからも呼ばれていなかった)を削除。
- `appGetRides`のループ内・`appPostRideEvaluatation`・`appGetNotification`の3箇所を
  `calculateDiscountedFareForRide(ride)`に置き換え。
- `appPostRides`: クーポン確定ロジックはそのままに、確定した`discount`を`let discount = 0`で
  追跡し、0より大きい場合のみ`UPDATE rides SET discount = ?`を発行。あわせて、確定直後に
  `SELECT * FROM rides WHERE id = ?`で再取得していた箇所(entries/0013・0014と同型の無駄)も、
  `reqJson`の値と`discount`変数からその場で運賃を計算する形にして削除。
- `ride`が未作成の見積り(`appPostRidesEstimatedFare`)のみ、従来の`calculateDiscountedFare`
  (coupon未確定状態からの見積りロジック)を維持。

コミット: `76e9078`(isucon14-webapp側は`git subtree push`で同期済み: `ac132f6`)

### 確認したリスク

キャッシュ列追加のたびに懸念している整合性については、バックフィル後に
`SELECT COUNT(*) FROM rides WHERE discount > 0`(332)と`SELECT COUNT(*) FROM coupons WHERE
used_by IS NOT NULL`(332)が一致することを確認。また、`coupons`テーブルを直接参照している
他のエンドポイント(`GET /api/owner/sales`)が今回の変更の影響を受けないことも実リクエストで確認した。

## 検証

直前(entries/0020)のafter計測をそのままbeforeとして使用(6176 / 5845 / 6825、中央値6176)。

- after: 6461(verboseLogging=true) / 6660 / 5967 → 中央値6461(約+4.6%)

仮説の根拠にした指標(`SELECT * FROM coupons WHERE used_by`の呼び出し回数)を、修正前後の
生ログへの`grep -c`で直接比較したところ、13995回→0回で完全に除去されたことを確認した。
このセッションで確認した中でも特に呼び出し回数の多いクエリだったため、CPU負荷の緩和という
観点では意味のある削減だったと考えられる。ただしスコアの伸び幅自体は+4.6%と、entries/0018
(hono/logger削除、+25.9%)ほど大きくはなかった。
