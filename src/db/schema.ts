import {
  index,
  integer,
  jsonb,
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
