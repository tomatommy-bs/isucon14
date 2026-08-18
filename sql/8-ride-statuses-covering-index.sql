-- ride_statuses.idx_ride_id_created_atはSELECT *のカバリングインデックスになっておらず、
-- status/app_sent_at/chair_sent_atはテーブル本体への追加のランダムI/Oが必要だった。
-- 最頻クエリ(appGetNotification/chairGetNotification由来、1回のベンチ実行で10万回近く発行)
-- のためカバリングインデックスに変更する。

ALTER TABLE ride_statuses
  DROP INDEX idx_ride_id_created_at,
  ADD INDEX idx_ride_id_created_at_covering (ride_id, created_at, status, app_sent_at, chair_sent_at);
