import type { Ride } from "./types/models.js";

export const INITIAL_FARE = 500;
export const FARE_PER_DISTANCE = 100;

// マンハッタン距離を求める
export const calculateDistance = (
  aLatitude: number,
  aLongitude: number,
  bLatitude: number,
  bLongitude: number,
): number => {
  return Math.abs(aLatitude - bLatitude) + Math.abs(aLongitude - bLongitude);
};

export const calculateFare = (
  pickupLatitude: number,
  pickupLongitude: number,
  destLatitude: number,
  destLongitude: number,
): number => {
  const meterdFare =
    FARE_PER_DISTANCE *
    calculateDistance(
      pickupLatitude,
      pickupLongitude,
      destLatitude,
      destLongitude,
    );
  return INITIAL_FARE + meterdFare;
};

export const calculateSale = (ride: Ride): number => {
  return calculateFare(
    ride.pickup_latitude,
    ride.pickup_longitude,
    ride.destination_latitude,
    ride.destination_longitude,
  );
};

// rides.discount(ライド作成時に確定し、以後変化しないクーポン割引額のキャッシュ列)を
// 使って、coupons.used_byへの追加クエリなしに割引後運賃を計算する。
export const calculateDiscountedFareForRide = (ride: Ride): number => {
  const meteredFare =
    FARE_PER_DISTANCE *
    calculateDistance(
      ride.pickup_latitude,
      ride.pickup_longitude,
      ride.destination_latitude,
      ride.destination_longitude,
    );
  return INITIAL_FARE + Math.max(meteredFare - ride.discount, 0);
};

export class ErroredUpstream extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroredUpstream";
  }
}
