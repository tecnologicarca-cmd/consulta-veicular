/**
 * Gerador de PIX "Copia e Cola" (BRCode) seguindo o padrão EMV do Banco Central.
 * Referência: Manual de Padrões para Iniciação do Pix.
 */

type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

const ID_PAYLOAD_FORMAT = "00";
const ID_MERCHANT_ACCOUNT = "26";
const ID_MERCHANT_CATEGORY = "52";
const ID_TRANSACTION_CURRENCY = "53";
const ID_TRANSACTION_AMOUNT = "54";
const ID_COUNTRY_CODE = "58";
const ID_MERCHANT_NAME = "59";
const ID_MERCHANT_CITY = "60";
const ID_ADDITIONAL_DATA = "62";
const ID_CRC = "63";

const GUI = "br.gov.bcb.pix";

function tlv(id: string, value: string): string {
  const length = String(value.length).padStart(2, "0");
  return `${id}${length}${value}`;
}

function normalizeKey(key: string, type: PixKeyType): string {
  const clean = key.trim();
  if (type === "cpf" || type === "cnpj") return clean.replace(/\D/g, "");
  if (type === "phone") {
    const digits = clean.replace(/\D/g, "");
    return digits.startsWith("55") ? `+55${digits.slice(2)}` : `+55${digits}`;
  }
  return clean;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function generatePixCode(input: {
  key: string;
  keyType: PixKeyType;
  amount: number;
  merchantName: string;
  merchantCity: string;
  txId: string;
}): string {
  const amount = input.amount.toFixed(2);
  const merchantAccount = tlv("00", GUI) + tlv("01", normalizeKey(input.key, input.keyType));
  const additionalData = tlv("05", input.txId.slice(0, 25));

  let payload =
    tlv(ID_PAYLOAD_FORMAT, "01") +
    tlv(ID_MERCHANT_ACCOUNT, merchantAccount) +
    tlv(ID_MERCHANT_CATEGORY, "0000") +
    tlv(ID_TRANSACTION_CURRENCY, "986") +
    tlv(ID_TRANSACTION_AMOUNT, amount) +
    tlv(ID_COUNTRY_CODE, "BR") +
    tlv(ID_MERCHANT_NAME, sanitizeName(input.merchantName)) +
    tlv(ID_MERCHANT_CITY, sanitizeName(input.merchantCity)) +
    tlv(ID_ADDITIONAL_DATA, additionalData);

  payload += tlv(ID_CRC, crc16(payload));
  return payload;
}

function sanitizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 &*.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 25) || "RECEBEDOR";
}

export function formatCentsToReal(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
