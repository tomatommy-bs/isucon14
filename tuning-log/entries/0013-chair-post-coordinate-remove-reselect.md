---
title: "chairPostCoordinateのINSERT直後の再SELECTを排除"
date: 2026-08-03
tags: [sql, cpu, polling]
commit: "a3e342b"
repo: webapp
metrics:
  before: { score: 4204 }
  after: { score: 4504 }
verboseLogging: false
logs:
  - label: "pt-query-digest (after, verboseLoggingあり参考計測)"
    path: "bench_logs/20260803_000252/mysql_slow.log"
    excerpt: |
      #    5 SELECT chair_locations (chair_id, ORDER BY created_at DESC LIMIT 1) 9572回  ← prevLocation取得(残存、想定通り)
      #   12 INSERT chair_locations 8584回
      「SELECT * FROM chair_locations WHERE id = ?」(INSERT直後の再取得)は上位20件から消滅を確認
  - label: "before スコア3回計測"
    path: "bench_logs/20260802_235555, 20260802_235712, 20260802_235827"
    excerpt: "entries/0012のafter計測をそのままbeforeとして使用: 4203 / 4604 / 3354 → 中央値4204"
  - label: "after スコア3回計測"
    path: "bench_logs/20260803_000252, 20260803_000415, 20260803_000533"
    excerpt: "4892(verbose) / 4504 / 4356 → 中央値4504"
---

## 計測値

entries/0012の続きでCPU逼迫の解消を進める中、`chairPostCoordinate`(椅子の位置情報POST、
ポーリング同様に高頻度)のコードを読み直したところ、以下の流れになっていた:

1. `INSERT INTO chair_locations (...)`(`created_at`はDBの`DEFAULT CURRENT_TIMESTAMP(6)`任せ)
2. 直後に`SELECT * FROM chair_locations WHERE id = ?`で今INSERTした行を**わざわざ取り直す**
3. その`location.created_at`を`chairs.total_distance_updated_at`の更新値、およびレスポンスの
   `recorded_at`として使う

このSELECTは「INSERTしたばかりの自分の書き込みを読むためだけ」のクエリで、pt-query-digestの
呼び出し回数ランキングにも独立した項目として現れていた(entries/0012時点のプロファイルで約7700回台)。

## 仮説

`created_at`をDBのDEFAULTに任せず、アプリ側で`new Date()`により生成した時刻をINSERT文に
明示的に含めれば、INSERT直後の再SELECTは不要になり、この分のDBラウンドトリップを完全に
削除できる。`chair_locations.created_at`は`datetime(6)`(マイクロ秒精度)だが、Node.jsの
`Date`はミリ秒精度までしか持たない。位置情報の送信間隔(数秒程度)を考えると精度低下は
実用上問題にならないと判断した。

## 変更

`chairPostCoordinate`(chair_handlers.ts)で、INSERT前に`const recordedAt = new Date();`を生成し、
`INSERT INTO chair_locations (id, chair_id, latitude, longitude, created_at) VALUES (...)`で
明示指定。以降`location.created_at`を参照していた箇所(`chairs.total_distance_updated_at`の更新、
レスポンスの`recorded_at`)を全て`recordedAt`に置き換え、INSERT直後の再SELECTを削除。
コミット: `a3e342b`(isucon14-webapp側は`git subtree push`で同期済み: `6c06e24`)

## 検証

直前(entries/0012)のafter計測をそのままbeforeとして使用(4203 / 4604 / 3354、中央値4204)。

- after: 4892(verboseLogging=true) / 4504 / 4356 → 中央値4504(約+7.1%)

仮説の根拠にした指標(INSERT直後の再SELECTクエリ)を変更後のpt-query-digest出力で確認したところ、
上位20件から完全に消滅していることを確認した(`chair_locations`関連で残っているのはprevLocation取得の
`SELECT ... WHERE chair_id = ? ORDER BY created_at DESC LIMIT 1`のみ)。今回はafter内の3回のブレ幅が
(4356〜4892)とこれまでの計測より小さく、多少安定して改善が出ている印象。ただしentries/0011・0012同様、
3回計測だけでは統計的な有意性までは主張できない。
