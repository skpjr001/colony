import { claimAlive, claimStrength } from "./core";

export const LAMBDA_PER_MIN = 0.2;
export const MIN_STRENGTH = 0.2;
export const CLAIM_TTL_MS = 30 * 60 * 1000;

export function rawStrength(strength0: number, lastHeartbeatMs: number, now: number): number {
  return claimStrength(strength0, lastHeartbeatMs, now);
}

export function roundedStrength(strength0: number, lastHeartbeatMs: number, now: number): number {
  return Math.round(rawStrength(strength0, lastHeartbeatMs, now) * 1000) / 1000;
}

export function isAlive(
  strength0: number,
  lastHeartbeatMs: number,
  ttlMs: number,
  released: number,
  now: number,
): boolean {
  return released === 0 && claimAlive(strength0, lastHeartbeatMs, ttlMs, now);
}
