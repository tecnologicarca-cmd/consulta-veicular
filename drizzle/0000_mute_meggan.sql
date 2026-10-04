CREATE TABLE "api_provider_settings" (
	"key" varchar(24) PRIMARY KEY NOT NULL,
	"encrypted_bearer" text,
	"encrypted_device" text,
	"admin_password_hash" text,
	"base_url" varchar(400) DEFAULT 'https://gateway.apibrasil.io/api/v2' NOT NULL,
	"endpoints" jsonb DEFAULT '{"dados":"/vehicles/dados","renavam":"/vehicles/base/000/dados","fipe":"/vehicles/fipe","multas":"/vehicles/multas","roubo":"/vehicles/roubo-furto","leilao":"/vehicles/leilao","recall":"/vehicles/recall"}'::jsonb NOT NULL,
	"payload_mapping" jsonb DEFAULT '{"placaField":"placa","renavamField":"renavam","renavamTypeField":"","renavamTypeValue":"renavam"}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"markup_percent" numeric(8, 2) DEFAULT '40' NOT NULL,
	"fixed_fee_cents" integer DEFAULT 0 NOT NULL,
	"minimum_charge_cents" integer DEFAULT 199 NOT NULL,
	"free_lookup_enabled" boolean DEFAULT true NOT NULL,
	"pix_provider" varchar(32) DEFAULT 'manual' NOT NULL,
	"pix_key_type" varchar(16) DEFAULT 'random' NOT NULL,
	"pix_key" varchar(160) DEFAULT '' NOT NULL,
	"mp_access_token" text,
	"mp_webhook_secret" text,
	"merchant_name" varchar(120) DEFAULT 'ARCA CONSULTAS' NOT NULL,
	"merchant_city" varchar(80) DEFAULT 'SAO PAULO' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultation_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"lookup_type" varchar(12) NOT NULL,
	"lookup_value" varchar(16) NOT NULL,
	"services" jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) NOT NULL,
	"pix_code" text,
	"pix_txid" varchar(80),
	"pix_provider" varchar(24) DEFAULT 'manual' NOT NULL,
	"provider_payment_id" varchar(80),
	"qr_code_base64" text,
	"payer_email" varchar(120),
	"result" jsonb,
	"paid_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_consultations" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"plate" varchar(7),
	"search_type" varchar(12) DEFAULT 'placa' NOT NULL,
	"search_value" varchar(16) DEFAULT '' NOT NULL,
	"services" jsonb NOT NULL,
	"status" varchar(24) NOT NULL,
	"source" varchar(24) NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consultation_orders_visitor_created_idx" ON "consultation_orders" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "consultation_orders_status_idx" ON "consultation_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consultation_orders_txid_idx" ON "consultation_orders" USING btree ("pix_txid");--> statement-breakpoint
CREATE INDEX "vehicle_consultations_visitor_created_idx" ON "vehicle_consultations" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "vehicle_consultations_plate_idx" ON "vehicle_consultations" USING btree ("plate");--> statement-breakpoint
CREATE INDEX "vehicle_consultations_search_value_idx" ON "vehicle_consultations" USING btree ("search_value");