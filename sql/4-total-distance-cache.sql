-- chairs.total_distance / total_distance_updated_at のキャッシュカラムを追加し、
-- 初期データ投入直後に一度だけ全履歴から集計してバックフィルする。
-- (以降はアプリ側で POST /api/chair/coordinate のたびに差分加算するのでこの重い集計は二度と走らない)

ALTER TABLE chairs
  ADD COLUMN total_distance INTEGER NOT NULL DEFAULT 0 COMMENT '累積走行距離キャッシュ',
  ADD COLUMN total_distance_updated_at DATETIME(6) NULL COMMENT '累積走行距離の最終更新日時';

UPDATE chairs
  LEFT JOIN (
    SELECT chair_id,
           SUM(IFNULL(distance, 0))  AS total_distance,
           MAX(created_at)           AS total_distance_updated_at
    FROM (
      SELECT chair_id,
             created_at,
             ABS(latitude - LAG(latitude) OVER (PARTITION BY chair_id ORDER BY created_at)) +
             ABS(longitude - LAG(longitude) OVER (PARTITION BY chair_id ORDER BY created_at)) AS distance
      FROM chair_locations
    ) tmp
    GROUP BY chair_id
  ) distance_table ON distance_table.chair_id = chairs.id
  SET chairs.total_distance = IFNULL(distance_table.total_distance, 0),
      chairs.total_distance_updated_at = distance_table.total_distance_updated_at;
