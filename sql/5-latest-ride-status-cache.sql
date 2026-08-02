-- rides.latest_status に最新ステータスをキャッシュし、getLatestRideStatus()相当の
-- 「SELECT status FROM ride_statuses WHERE ride_id = ? ORDER BY created_at DESC LIMIT 1」を
-- ridesを既に取得済みの箇所では発行不要にする。
-- (以降はアプリ側でride_statusesへのINSERTのたびにridesも合わせて更新するのでこの集計は二度と走らない)

ALTER TABLE rides
  ADD COLUMN latest_status ENUM('MATCHING', 'ENROUTE', 'PICKUP', 'CARRYING', 'ARRIVED', 'COMPLETED')
    NOT NULL DEFAULT 'MATCHING' COMMENT '最新ステータスキャッシュ';

UPDATE rides
  JOIN (
    SELECT rs1.ride_id, rs1.status
    FROM ride_statuses rs1
    JOIN (
      SELECT ride_id, MAX(created_at) AS max_created_at
      FROM ride_statuses
      GROUP BY ride_id
    ) rs2 ON rs1.ride_id = rs2.ride_id AND rs1.created_at = rs2.max_created_at
  ) latest ON latest.ride_id = rides.id
  -- updated_at は ON UPDATE CURRENT_TIMESTAMP(6) のため、明示的に自分自身を再代入して
  -- このUPDATEによる意図しないタイムスタンプ更新(バックフィル実行時刻への巻き戻り)を防ぐ
  SET rides.latest_status = latest.status,
      rides.updated_at = rides.updated_at;
