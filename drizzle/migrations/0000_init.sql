CREATE TABLE "activation_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customer_label" text,
	"mode" text NOT NULL,
	"quota_eur" numeric(10, 2),
	"used_eur" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freepik_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"key_encrypted" text NOT NULL,
	"assigned_eur" numeric(10, 2) DEFAULT '500.00' NOT NULL,
	"used_eur" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"tier" text,
	"duration_seconds" smallint,
	"with_audio" boolean DEFAULT false NOT NULL,
	"cost_eur" numeric(10, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"key_id" uuid,
	"endpoint" text NOT NULL,
	"tier" text,
	"duration_seconds" smallint,
	"with_audio" boolean DEFAULT false NOT NULL,
	"cost_eur" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"freepik_task_id" text,
	"video_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_code_id_activation_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."activation_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_key_id_freepik_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."freepik_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activation_codes_code_uniq" ON "activation_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_lookup_uniq" ON "pricing_rules" USING btree ("endpoint","tier","duration_seconds","with_audio");--> statement-breakpoint
CREATE INDEX "usage_logs_code_id_idx" ON "usage_logs" USING btree ("code_id");--> statement-breakpoint
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs" USING btree ("created_at");