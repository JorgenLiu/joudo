/**
 * TOTP authentication for Joudo bridge.
 *
 * Implements RFC 6238 using Node.js crypto.
 * Secret is stored in ~/.joudo/totp-secret (mode 0600).
 * On first startup, generates a new secret and prints a QR code to the terminal.
 */

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// @ts-expect-error qrcode-terminal has no type declarations
import qrcode from "qrcode-terminal";

const TOTP_STEP = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept ±1 time step

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

function generateHotp(secret: Buffer, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  const secret = base32Decode(secretBase32);
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const counter = (now + BigInt(offset * TOTP_STEP)) / BigInt(TOTP_STEP);
    if (generateHotp(secret, counter) === code) {
      return true;
    }
  }

  return false;
}

export function getTotpUri(secretBase32: string, label: string): string {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secretBase32}&issuer=Joudo&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;
}

const CONFIG_DIR = join(homedir(), ".joudo");
const SECRET_FILE = join(CONFIG_DIR, "totp-secret");

export function loadOrCreateSecret(): { secret: string; isNew: boolean } {
  if (existsSync(SECRET_FILE)) {
    const secret = readFileSync(SECRET_FILE, "utf8").trim();
    if (secret.length > 0) {
      return { secret, isNew: false };
    }
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const secret = generateSecret();
  writeFileSync(SECRET_FILE, secret + "\n", { mode: 0o600 });
  return { secret, isNew: true };
}

export function printTotpQrCode(secretBase32: string): void {
  const uri = getTotpUri(secretBase32, "Joudo Bridge");

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Joudo TOTP Pairing — scan with Authenticator   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  qrcode.generate(uri, { small: true }, (qr: string) => {
    console.log(qr);
  });

  console.log(`\nManual entry secret: ${secretBase32}`);
  console.log(`URI: ${uri}\n`);
}

export function resetSecret(): { secret: string } {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const secret = generateSecret();
  writeFileSync(SECRET_FILE, secret + "\n", { mode: 0o600 });
  return { secret };
}
