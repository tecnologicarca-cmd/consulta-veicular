import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  ConsultationSource,
  ConsultationStatus,
  LookupType,
  ServiceSelection,
} from "@/lib/vehicles";

export interface ApiEndpointPaths {
  dados: string;
  renavam: string;
  fipe: string;
  multas: string;
  roubo: string;
  leilao: string;
  recall: string;
}

export const defaultApiEndpointPaths: ApiEndpointPaths = {
  dados: "/vehicles/dados",
  renavam: "/vehicles/base/000/dados",
  fipe: "/vehicles/fipe",
  multas: "/vehicles/multas",
  roubo: "/vehicles/roubo-furto",
  leilao: "/vehicles/leilao",
  recall: "/vehicles/recall",
};

export interface ApiPayloadMapping {
  placaField: string;
  renavamField: string;
  renavamTypeField: string;
  renavamTypeValue: string;
}

export const defaultApiPayloadMapping: ApiPayloadMapping = {
  placaField: "placa",
  renavamField: "renavam",
  renavamTypeField: "",
  renavamTypeValue: "renavam",
};

export const vehicleConsultations = pgTable(
  "vehicle_consultations",
  {
    id: serial("id").primaryKey(),
    visitorId: varchar("visitor_id", { length: 64 }).notNull(),
    plate: varchar("plate", { length: 7 }),
    searchType: varchar("search_type", { length: 12 }).$type<LookupType>().default("placa").notNull(),
    searchValue: varchar("search_value", { length: 16 }).notNull().default(""),
    services: jsonb("services").$type<ServiceSelection>().notNull(),
    status: varchar("status", { length: 24 })
      .$type<ConsultationStatus>()
      .notNull(),
    source: varchar("source", { length: 24 })
      .$type<ConsultationSource>()
      .notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("vehicle_consultations_visitor_created_idx").on(
      table.visitorId,
      table.createdAt,
    ),
    index("vehicle_consultations_plate_idx").on(table.plate),
    index("vehicle_consultations_search_value_idx").on(table.searchValue),
  ],
);

export const apiProviderSettings = pgTable("api_provider_settings", {
  key: varchar("key", { length: 24 }).primaryKey(),
  encryptedBearer: text("encrypted_bearer"),
  encryptedDevice: text("encrypted_device"),
  adminPasswordHash: text("admin_password_hash"),
  baseUrl: varchar("base_url", { length: 400 }).notNull().default("https://gateway.apibrasil.io/api/v2"),
  endpoints: jsonb("endpoints").$type<ApiEndpointPaths>().notNull().default(defaultApiEndpointPaths),
  payloadMapping: jsonb("payload_mapping").$type<ApiPayloadMapping>().notNull().default(defaultApiPayloadMapping),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export type OrderStatus = "pending" | "paid" | "confirmed" | "cancelled" | "expired";
export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

export interface BusinessPricing {
  markupPercent: string;
  fixedFeeCents: number;
  minimumChargeCents: number;
  freeLookupEnabled: boolean;
}

export interface BusinessPix {
  pixProvider: string;
  pixKeyType: PixKeyType;
  pixKey: string;
  merchantName: string;
  merchantCity: string;
}

export const businessSettings = pgTable("business_settings", {
  key: varchar("key", { length: 32 }).primaryKey(),
  markupPercent: numeric("markup_percent", { precision: 8, scale: 2 })
    .notNull()
    .default("40"),
  fixedFeeCents: integer("fixed_fee_cents").notNull().default(0),
  minimumChargeCents: integer("minimum_charge_cents").notNull().default(199),
  freeLookupEnabled: boolean("free_lookup_enabled").notNull().default(true),
  pixProvider: varchar("pix_provider", { length: 32 }).notNull().default("manual"),
  pixKeyType: varchar("pix_key_type", { length: 16 })
    .$type<PixKeyType>()
    .notNull()
    .default("random"),
  pixKey: varchar("pix_key", { length: 160 }).notNull().default(""),
  mpAccessToken: text("mp_access_token"),
  mpWebhookSecret: text("mp_webhook_secret"),
  merchantName: varchar("merchant_name", { length: 120 }).notNull().default("ARCA CONSULTAS"),
  merchantCity: varchar("merchant_city", { length: 80 }).notNull().default("SAO PAULO"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const consultationOrders = pgTable(
  "consultation_orders",
  {
    id: serial("id").primaryKey(),
    visitorId: varchar("visitor_id", { length: 64 }).notNull(),
    lookupType: varchar("lookup_type", { length: 12 }).$type<LookupType>().notNull(),
    lookupValue: varchar("lookup_value", { length: 16 }).notNull(),
    services: jsonb("services").$type<ServiceSelection>().notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    priceCents: integer("price_cents").notNull().default(0),
    status: varchar("status", { length: 16 }).$type<OrderStatus>().notNull(),
    pixCode: text("pix_code"),
    pixTxId: varchar("pix_txid", { length: 80 }),
    pixProvider: varchar("pix_provider", { length: 24 }).notNull().default("manual"),
    providerPaymentId: varchar("provider_payment_id", { length: 80 }),
    qrCodeBase64: text("qr_code_base64"),
    payerEmail: varchar("payer_email", { length: 120 }),
    result: jsonb("result"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("consultation_orders_visitor_created_idx").on(
      table.visitorId,
      table.createdAt,
    ),
    index("consultation_orders_status_idx").on(table.status),
    index("consultation_orders_txid_idx").on(table.pixTxId),
  ],
);
