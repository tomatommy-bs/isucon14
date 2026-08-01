---
title: "coupons.used_byへのインデックス追加"
date: 2026-07-29
tags: [index, mysql, full-scan]
commit: "babfb36"
repo: webapp
metrics:
  before:
    score: 2620
  after:
    score: 3117
logs: []
---

## 計測値

0004の再ベンチ後、`pt-query-digest`の1位が`SELECT coupons`（13.8%、7,159回呼び出し）。`EXPLAIN SELECT * FROM coupons WHERE used_by = ?` → `type: ALL`（565行フルスキャン）。`coupons`のPRIMARY KEYは`(user_id, code)`のみで`used_by`列にインデックスなし。

## 仮説

`used_by`にインデックスを追加すればフルスキャンが解消するはず（テーブル自体は小さい（565行）が、頻繁に呼ばれるため累積コストが大きい）。

## 変更

`sql/1-schema.sql`に`INDEX idx_used_by (used_by)`を追加。稼働中DBにも`CREATE INDEX`で即時反映して先に効果検証してから、コード側の変更なしでコミット。

## 検証

- `EXPLAIN`: `type: ALL`（565行）→**`type: ref`**（1行のみ、インデックス経由）
- ベンチマーク実測: **スコア 2620 → 3117（+19%）**、`pass=true`
- 0004（COMMITチューニング）は単体では横ばいだったが、こちらは明確にスコアへ寄与した。同じ「フルスキャン解消」でも、対象クエリの呼び出し頻度や他ボトルネックとの位置関係によって効果の出方が変わることを実感

コミットは`sudo`実行だと所有者不一致で`.git/index.lock`のPermission deniedになったため、`sudo -u isucon git ...`で実行（webappリポジトリはisucon所有）。
