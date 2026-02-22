CREATE TABLE "architecture_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_layers_ws_name" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "object_layer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_layer_assign" UNIQUE("workspace_id","object_id")
);
--> statement-breakpoint
ALTER TABLE "architecture_layers" ADD CONSTRAINT "architecture_layers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_layer_assignments" ADD CONSTRAINT "object_layer_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_layer_assignments" ADD CONSTRAINT "object_layer_assignments_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_layer_assignments" ADD CONSTRAINT "object_layer_assignments_layer_id_architecture_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."architecture_layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_layers_ws_sort" ON "architecture_layers" USING btree ("workspace_id","sort_order");--> statement-breakpoint
CREATE INDEX "ix_layer_assign_layer" ON "object_layer_assignments" USING btree ("layer_id");