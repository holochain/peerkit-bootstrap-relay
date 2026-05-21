/**
 * @fileoverview Network access bytes computation and verification for peerkit relay.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const computeNetworkAccessBytes = (secret: string): Uint8Array =>
  createHash("sha256").update(secret).digest();

export const verifyNetworkAccessBytes = (
  secret: Uint8Array,
  bytes: Uint8Array,
): boolean => bytes.length === secret.length && timingSafeEqual(bytes, secret);
