CREATE TABLE "object_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"subject_object_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"interaction_kind" text,
	"direction" text,
	"is_derived" boolean DEFAULT false NOT NULL,
	"confidence" real,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_object_relations" UNIQUE("workspace_id","relation_type","subject_object_id","object_id","is_derived")
);
--> statement-breakpoint
CREATE TABLE "object_tags" (
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"category" text,
	"granularity" text DEFAULT 'ATOMIC' NOT NULL,
	"urn" text,
	"name" text NOT NULL,
	"display_name" text,
	"description" text,
	"parent_id" uuid,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'VISIBLE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"subject_object_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tags_ws_name" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"file_path" text,
	"line_start" integer,
	"line_end" integer,
	"excerpt" text,
	"uri" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_candidate_evidences" (
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_evidences" (
	"workspace_id" uuid NOT NULL,
	"relation_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_graph_stats" (
	"workspace_id" uuid NOT NULL,
	"generation_version" bigint NOT NULL,
	"rollup_level" text NOT NULL,
	"object_id" uuid NOT NULL,
	"out_degree" integer NOT NULL,
	"in_degree" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rollup_level" text NOT NULL,
	"relation_type" text NOT NULL,
	"subject_object_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"edge_weight" integer DEFAULT 1 NOT NULL,
	"confidence" real,
	"generation_version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollup_generations" (
	"workspace_id" uuid NOT NULL,
	"generation_version" bigint NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'BUILDING' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_candidate_evidences" (
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid,
	"object_id" uuid NOT NULL,
	"affinity_map" jsonb NOT NULL,
	"purity" real NOT NULL,
	"primary_domain_id" uuid,
	"secondary_domain_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_discovery_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"affinity" real NOT NULL,
	"purity" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ddm" UNIQUE("workspace_id","run_id","object_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "domain_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_id" uuid,
	"algo" text NOT NULL,
	"algo_version" text,
	"input_layers" jsonb NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graph_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'DONE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_inference_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'NAMED' NOT NULL,
	"is_default" boolean DEFAULT false,
	"w_code" real DEFAULT 0.5,
	"w_db" real DEFAULT 0.3,
	"w_msg" real DEFAULT 0.2,
	"heuristic_domain_cap" real DEFAULT 0.3,
	"secondary_threshold" real DEFAULT 0.25,
	"edge_w_call" real DEFAULT 1,
	"edge_w_rw" real DEFAULT 0.8,
	"edge_w_msg" real DEFAULT 0.6,
	"edge_w_fk" real DEFAULT 0.4,
	"edge_w_code" real DEFAULT 0.7,
	"min_cluster_size" integer DEFAULT 3,
	"resolution" real,
	"enabled_layers" jsonb DEFAULT '["call","db","msg","code"]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_profile_ws_name" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "domain_rollup_provenances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"generation_version" bigint NOT NULL,
	"domain_rollup_id" uuid NOT NULL,
	"source_service_rollup_id" uuid NOT NULL,
	"factor" real NOT NULL,
	"contributed_weight" real NOT NULL,
	"contributed_confidence" real,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "object_domain_affinities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"affinity" real NOT NULL,
	"confidence" real,
	"source" text DEFAULT 'APPROVED_INFERENCE' NOT NULL,
	"generation_version" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_oda" UNIQUE("workspace_id","object_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "code_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"language" text NOT NULL,
	"repo_root" text,
	"file_path" text NOT NULL,
	"package_name" text,
	"module_name" text,
	"owner_object_id" uuid,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_code_artifacts_ws_path" UNIQUE("workspace_id","file_path")
);
--> statement-breakpoint
CREATE TABLE "code_call_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"caller_artifact_id" uuid NOT NULL,
	"callee_symbol" text NOT NULL,
	"callee_owner_object_id" uuid,
	"weight" integer DEFAULT 1 NOT NULL,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_import_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_artifact_id" uuid NOT NULL,
	"to_module" text,
	"to_artifact_id" uuid,
	"weight" integer DEFAULT 1 NOT NULL,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "object_relations" ADD CONSTRAINT "object_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_relations" ADD CONSTRAINT "object_relations_subject_object_id_objects_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_relations" ADD CONSTRAINT "object_relations_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_tags" ADD CONSTRAINT "object_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_tags" ADD CONSTRAINT "object_tags_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_tags" ADD CONSTRAINT "object_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_candidates" ADD CONSTRAINT "relation_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_candidates" ADD CONSTRAINT "relation_candidates_subject_object_id_objects_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_candidates" ADD CONSTRAINT "relation_candidates_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_candidate_evidences" ADD CONSTRAINT "relation_candidate_evidences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_candidate_evidences" ADD CONSTRAINT "relation_candidate_evidences_candidate_id_relation_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."relation_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_candidate_evidences" ADD CONSTRAINT "relation_candidate_evidences_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_evidences" ADD CONSTRAINT "relation_evidences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_evidences" ADD CONSTRAINT "relation_evidences_relation_id_object_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."object_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_evidences" ADD CONSTRAINT "relation_evidences_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_graph_stats" ADD CONSTRAINT "object_graph_stats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_graph_stats" ADD CONSTRAINT "object_graph_stats_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_rollups" ADD CONSTRAINT "object_rollups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_rollups" ADD CONSTRAINT "object_rollups_subject_object_id_objects_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_rollups" ADD CONSTRAINT "object_rollups_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollup_generations" ADD CONSTRAINT "rollup_generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_candidate_evidences" ADD CONSTRAINT "domain_candidate_evidences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_candidate_evidences" ADD CONSTRAINT "domain_candidate_evidences_candidate_id_domain_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."domain_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_candidate_evidences" ADD CONSTRAINT "domain_candidate_evidences_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_candidates" ADD CONSTRAINT "domain_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_candidates" ADD CONSTRAINT "domain_candidates_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_candidates" ADD CONSTRAINT "domain_candidates_primary_domain_id_objects_id_fk" FOREIGN KEY ("primary_domain_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_discovery_memberships" ADD CONSTRAINT "domain_discovery_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_discovery_memberships" ADD CONSTRAINT "domain_discovery_memberships_run_id_domain_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."domain_discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_discovery_memberships" ADD CONSTRAINT "domain_discovery_memberships_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_discovery_memberships" ADD CONSTRAINT "domain_discovery_memberships_domain_id_objects_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_discovery_runs" ADD CONSTRAINT "domain_discovery_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_discovery_runs" ADD CONSTRAINT "domain_discovery_runs_profile_id_domain_inference_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."domain_inference_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_inference_profiles" ADD CONSTRAINT "domain_inference_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_rollup_provenances" ADD CONSTRAINT "domain_rollup_provenances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_domain_affinities" ADD CONSTRAINT "object_domain_affinities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_domain_affinities" ADD CONSTRAINT "object_domain_affinities_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_domain_affinities" ADD CONSTRAINT "object_domain_affinities_domain_id_objects_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_artifacts" ADD CONSTRAINT "code_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_artifacts" ADD CONSTRAINT "code_artifacts_owner_object_id_objects_id_fk" FOREIGN KEY ("owner_object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_call_edges" ADD CONSTRAINT "code_call_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_call_edges" ADD CONSTRAINT "code_call_edges_caller_artifact_id_code_artifacts_id_fk" FOREIGN KEY ("caller_artifact_id") REFERENCES "public"."code_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_call_edges" ADD CONSTRAINT "code_call_edges_callee_owner_object_id_objects_id_fk" FOREIGN KEY ("callee_owner_object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_call_edges" ADD CONSTRAINT "code_call_edges_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_import_edges" ADD CONSTRAINT "code_import_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_import_edges" ADD CONSTRAINT "code_import_edges_from_artifact_id_code_artifacts_id_fk" FOREIGN KEY ("from_artifact_id") REFERENCES "public"."code_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_import_edges" ADD CONSTRAINT "code_import_edges_to_artifact_id_code_artifacts_id_fk" FOREIGN KEY ("to_artifact_id") REFERENCES "public"."code_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_import_edges" ADD CONSTRAINT "code_import_edges_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_rel_ws_subject" ON "object_relations" USING btree ("workspace_id","subject_object_id");--> statement-breakpoint
CREATE INDEX "ix_rel_ws_object" ON "object_relations" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE INDEX "ix_rel_ws_type" ON "object_relations" USING btree ("workspace_id","relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_objects_ws_urn" ON "objects" USING btree ("workspace_id","urn") WHERE "urn" is not null;--> statement-breakpoint
CREATE INDEX "ix_objects_ws_type" ON "objects" USING btree ("workspace_id","object_type");--> statement-breakpoint
CREATE INDEX "ix_objects_ws_parent" ON "objects" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "ix_objects_ws_path" ON "objects" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "ix_relcand_ws_status" ON "relation_candidates" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "ix_rel_ev_relation" ON "relation_evidences" USING btree ("workspace_id","relation_id");--> statement-breakpoint
CREATE INDEX "ix_rollup_out" ON "object_rollups" USING btree ("workspace_id","generation_version","rollup_level","subject_object_id");--> statement-breakpoint
CREATE INDEX "ix_rollup_in" ON "object_rollups" USING btree ("workspace_id","generation_version","rollup_level","object_id");--> statement-breakpoint
CREATE INDEX "ix_rollup_type" ON "object_rollups" USING btree ("workspace_id","generation_version","rollup_level","relation_type");--> statement-breakpoint
CREATE INDEX "ix_domcand_ws_status" ON "domain_candidates" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "ix_domcand_ws_object" ON "domain_candidates" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE INDEX "ix_ddm_ws_run" ON "domain_discovery_memberships" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "ix_ddm_ws_object" ON "domain_discovery_memberships" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE INDEX "ix_ddm_ws_domain" ON "domain_discovery_memberships" USING btree ("workspace_id","domain_id");--> statement-breakpoint
CREATE INDEX "ix_ddr_ws_time" ON "domain_discovery_runs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "ix_oda_ws_object" ON "object_domain_affinities" USING btree ("workspace_id","object_id");--> statement-breakpoint
CREATE INDEX "ix_oda_ws_domain" ON "object_domain_affinities" USING btree ("workspace_id","domain_id");--> statement-breakpoint
CREATE INDEX "ix_code_artifacts_ws_owner" ON "code_artifacts" USING btree ("workspace_id","owner_object_id");--> statement-breakpoint
CREATE INDEX "ix_code_artifacts_ws_lang" ON "code_artifacts" USING btree ("workspace_id","language");--> statement-breakpoint
CREATE INDEX "ix_call_edges_ws_caller" ON "code_call_edges" USING btree ("workspace_id","caller_artifact_id");--> statement-breakpoint
CREATE INDEX "ix_call_edges_ws_callee" ON "code_call_edges" USING btree ("workspace_id","callee_owner_object_id");--> statement-breakpoint
CREATE INDEX "ix_import_edges_ws_from" ON "code_import_edges" USING btree ("workspace_id","from_artifact_id");--> statement-breakpoint
CREATE INDEX "ix_import_edges_ws_to" ON "code_import_edges" USING btree ("workspace_id","to_artifact_id");--> statement-breakpoint
CREATE INDEX "ix_changelog_ws_entity" ON "change_logs" USING btree ("workspace_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_changelog_ws_time" ON "change_logs" USING btree ("workspace_id","created_at");