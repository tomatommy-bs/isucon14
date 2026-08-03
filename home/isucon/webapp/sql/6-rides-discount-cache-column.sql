-- rides.discount にライド作成時点で確定したクーポン割引額をキャッシュし、
-- 「SELECT * FROM coupons WHERE used_by = ?」による毎回の再計算(特にappGetNotificationの
-- ポーリングで最頻)を不要にする。coupons.used_byはライド作成時に一度だけ設定され、
-- 以降変化しないため、キャッシュしても不整合は生じない。
-- (以降はアプリ側でrides作成時にdiscountも一緒にINSERTするのでこのバックフィルは二度と走らない)

ALTER TABLE rides
  ADD COLUMN discount INTEGER NOT NULL DEFAULT 0 COMMENT '適用クーポン割引額キャッシュ';

UPDATE rides
  LEFT JOIN coupons ON coupons.used_by = rides.id
  -- updated_at は ON UPDATE CURRENT_TIMESTAMP(6) のため、明示的に自分自身を再代入して
  -- このUPDATEによる意図しないタイムスタンプ更新(entries/0015と同種の落とし穴)を防ぐ
  SET rides.discount = IFNULL(coupons.discount, 0),
      rides.updated_at = rides.updated_at;
