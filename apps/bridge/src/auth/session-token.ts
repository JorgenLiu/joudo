/**
 * Session token management for authenticated bridge sessions.
 *
 * After TOTP verification succeeds, the bridge issues a random bearer token
 * that the web client stores in localStorage and sends on every request.
 *
 * Tokens expire after 8 hours but are renewed on WebSocket activity.
 */

import { randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const TOKEN_BYTE_LENGTH = 32;

interface TokenRecord {
  expiresAt: number;
}

const tokens = new Map<string, TokenRecord>();

export function createSessionToken(): string {
  const token = randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
  tokens.set(token, { expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function validateSessionToken(token: string): boolean {
  const record = tokens.get(token);
  if (!record) {
    return false;
  }

  if (Date.now() > record.expiresAt) {
    tokens.delete(token);
    return false;
  }

  return true;
}

export function renewSessionToken(token: string): void {
  const record = tokens.get(token);
  if (record) {
    record.expiresAt = Date.now() + TOKEN_TTL_MS;
  }
}

export function revokeAllTokens(): void {
  tokens.clear();
}
