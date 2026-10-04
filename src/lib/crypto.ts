import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function encryptionKey(): Buffer {
  const master = process.env.APIBRASIL_SETTINGS_ENCRYPTION_KEY?.trim() || process.env.DATABASE_URL;
  if (!master) {
    throw new CryptoError(
      "Configure DATABASE_URL ou APIBRASIL_SETTINGS_ENCRYPTION_KEY no servidor para criptografar segredos.",
    );
  }
  return createHash("sha256").update(`arca-secrets-v1:${master}`).digest();
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivHex, tagHex, encryptedHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !encryptedHex) {
    throw new CryptoError("Formato de segredo cifrado inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

export function safeDecrypt(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return "";
  }
}
