---
title: "appPostRideEvaluatationのUPDATE後の再SELECT ridesを排除"
date: 2026-08-03
tags: [sql]
commit: "39c5141"
repo: webapp
metrics:
  before: { score: 4504 }
  after: { score: 4708 }
verboseLogging: false
logs:
  - label: "SELECT * FROM rides WHERE id = の出現回数(生ログgrep)"
    path: "bench_logs/20260803_000252/mysql_slow.log, bench_logs/20260803_001026/mysql_slow.log"
    excerpt: "before(修正前): 323回 → after(修正後): 211回(約35%減)"
  - label: "before スコア3回計測"
    path: "bench_logs/20260803_000252, 20260803_000415, 20260803_000533"
    excerpt: "entries/0013のafter計測をそのままbeforeとして使用: 4892(verbose) / 4504 / 4356 → 中央値4504"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_001026, 20260803_001141, 20260803_001256"
    excerpt: "3555(verbose) / 4708 / 4967(CODE=17のPOST /api/app/users失敗1件を含む) → 中央値4708"
---

## 計測値

entries/0013の流れで他ハンドラも見直した。`appPostRideEvaluatation`(app_handlers.ts)は
`entries/0013`と同型のパターンで、`UPDATE rides SET evaluation = ?`の直後に
`SELECT * FROM rides WHERE id = ?`で同じ行を再取得していた。取得目的は`ride.updated_at`
(`ON UPDATE CURRENT_TIMESTAMP(6)`で自動更新される値)をレスポンスの`completed_at`に
使うためだけで、他のフィールド(`pickup_latitude`等、`calculateDiscountedFare`に渡す値)は
最初のSELECT時点から変化していない。

## 仮説

entries/0013と同様、`updated_at`をDBの自動更新に任せず、アプリ側で生成した`Date`を
UPDATE文に明示指定すれば、直後の再SELECTは不要になる。ただしこのエンドポイントは
`appGetNotification`等のポーリング系ほど呼び出し頻度が高くないため、削減効果は
entries/0012・0013より小さいと予想した。

## 変更

`appPostRideEvaluatation`で`const completedAt = new Date();`を生成し、
`UPDATE rides SET evaluation = ?, updated_at = ? WHERE id = ?`で明示指定。
以降`ride.updated_at`を参照していたレスポンス組み立て部分を`completedAt`に置き換え、
UPDATE後の再SELECTを削除。同時に`let [[ride]]`を`const [[ride]]`に変更(再代入不要になったため)。
コミット: `39c5141`(isucon14-webapp側は`git subtree push`で同期済み: `9e43af3`)

## 検証

直前(entries/0013)のafter計測をそのままbeforeとして使用(4892 / 4504 / 4356、中央値4504)。

- after: 3555(verboseLogging=true) / 4708 / 4967 → 中央値4708(約+4.5%)

仮説の根拠にした指標(`SELECT * FROM rides WHERE id = `の出現回数)を、生ログへの単純`grep -c`で
before/after直接比較したところ、323回→211回(約35%減)と削減を確認した。ただし
`appPostRideEvaluatation`自体の呼び出し頻度は`appGetNotification`等のポーリング系エンドポイントに
比べて低いため、entries/0012・0013(中央値+14.4%・+7.1%)より効果は小さめだった。

なお、この計測回でCODE=17(`POST /api/app/users`が500)のエラーが1件観測された。今回変更した
エンドポイントとは無関係(ユーザー登録は今回未変更)で、`journalctl`でも該当時刻に有効なスタック
トレースは見つからなかった。既存の潜在的な不安定要因の可能性があり、次回以降で再現するか注視したい。
