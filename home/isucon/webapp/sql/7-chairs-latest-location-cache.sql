-- chairs.latest_latitude / latest_longitude に最新位置情報をキャッシュし、
-- appGetNearbyChairsで全椅子分の最新位置をchair_locationsへのGROUP BY集計
-- (entries/0020で導入したクエリ、chair_locationsが増え続けるほどコストが増す)なしに
-- 引けるようにする。
-- (以降はアプリ側でchairPostCoordinateのたびにchairsも合わせて更新するのでこの集計は
--  以後appGetNearbyChairs側では二度と走らない)

ALTER TABLE chairs
  ADD COLUMN latest_latitude INTEGER NULL COMMENT '最新位置情報キャッシュ(経度)',
  ADD COLUMN latest_longitude INTEGER NULL COMMENT '最新位置情報キャッシュ(緯度)';

UPDATE chairs
  LEFT JOIN (
    SELECT cl1.chair_id, cl1.latitude, cl1.longitude
    FROM chair_locations cl1
    JOIN (
      SELECT chair_id, MAX(created_at) AS max_created_at
      FROM chair_locations
      GROUP BY chair_id
    ) cl2 ON cl1.chair_id = cl2.chair_id AND cl1.created_at = cl2.max_created_at
  ) latest ON latest.chair_id = chairs.id
  -- updated_at は ON UPDATE CURRENT_TIMESTAMP(6) のため、明示的に自分自身を再代入して
  -- このUPDATEによる意図しないタイムスタンプ更新(entries/0015・0021と同種の落とし穴)を防ぐ
  SET chairs.latest_latitude = latest.latitude,
      chairs.latest_longitude = latest.longitude,
      chairs.updated_at = chairs.updated_at;
