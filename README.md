# Archi.Navi

[한국어](README.ko.md)

> A Living Architecture Map for MSA Teams\
> *Stop guessing your system. Start seeing it clearly.*

------------------------------------------------------------------------

## 🚨 The Challenge

Operating microservices still raises difficult questions:

-   Which services depend on this one?
-   Why did a small change trigger failures elsewhere?
-   Is our architecture view still aligned with reality?
-   Can anyone explain the full flow across API, MQ, and DB?

Microservice systems evolve faster than static documents.

**Archi.Navi** addresses this gap by turning your repositories into a
**live, explorable architecture map** with approval-based knowledge
updates.

------------------------------------------------------------------------

## 🧭 What Archi.Navi Provides

Archi.Navi analyzes repositories in your GitHub organization and
delivers:

-   🔍 Searchable service overview with tags and visibility controls
-   🔗 Dependency graph for impact analysis
-   🏗 Architecture View (roll-up perspective)
-   🧩 Object Mapping View (drill-down/roll-down perspective)
-   ✅ Approval queue for inferred changes before applying
-   💬 Evidence-based AI Chat over your architecture knowledge

This is not a static documentation tool.\
It is an operational visibility tool for real-world MSA environments.

------------------------------------------------------------------------

## 🧩 Core Concepts

If you are new to Archi.Navi, these terms are the foundation:

-   **Object**
    The unified unit in the model. Services, API endpoints, databases,
    tables, topics, queues, and more are all represented as `Object`.
-   **Service**
    A special `Object` type (`object_type=service`) used as the primary
    operational boundary.
-   **Relation**
    A typed connection between objects (`call`, `read`, `write`,
    `produce`, `consume`, `expose`, `depend_on`).
-   **Roll-up View**
    A summarized architecture perspective for fast impact analysis.
-   **Roll-down View**
    A detailed drill-down perspective for selected objects and concrete
    flows.
-   **Change Request (Approval Queue)**
    Inferred changes are queued first and applied only after
    approve/reject actions.
-   **Evidence**
    Source context supporting inferred relations or AI answers.
-   **Visibility**
    `VISIBLE` / `HIDDEN` control for inclusion in default views.
-   **Workspace**
    Logical isolation boundary for future multi-org/repo operation.

Understanding these concepts makes the product behavior much easier to
predict and trust.

------------------------------------------------------------------------

## ✨ Key Features

### 1. Service Overview

-   Service list with search
-   Alias / Type / Visibility management
-   Tag creation and editing
-   CSV export

This provides a shared structural language across teams.

------------------------------------------------------------------------

### 2. Dependency Graph

-   Interactive service dependency visualization
-   Inbound / Outbound inspection
-   Search-based node highlighting
-   Hide support via visibility (`VISIBLE` / `HIDDEN`)

This makes release impact analysis faster and more reliable.

------------------------------------------------------------------------

### 3. Architecture View + Object Mapping View

-   Architecture View for high-level roll-up structure
-   Object Mapping View for object-level drill-down
-   Dynamic edge-type filtering
-   PNG export support

This keeps strategic and detailed perspectives in one workflow.

------------------------------------------------------------------------

### 4. Approval Workflow

-   Inferred dependency changes go to `change_requests`
-   Bulk approve/reject with selection support
-   Approved items are materialized into relations

This protects trust in graph data while keeping automation useful.

------------------------------------------------------------------------

### 5. AI Chat (Evidence-first)

-   Architecture Q&A through local knowledge
-   Confidence + evidence driven responses
-   No final-answer style response without evidence

------------------------------------------------------------------------

## ✅ Who Should Use This

-   Teams actively operating MSA environments
-   Organizations managing multiple repositories
-   Backend / platform teams requiring impact analysis
-   Teams with costly onboarding due to structural complexity
-   Projects where docs easily drift from reality

If your architecture must be explainable and operationally visible, this
tool is designed for you.

------------------------------------------------------------------------

## 🏗 Repository Structure

```text
apps/
  web/                 # Next.js UI
packages/
  core/                # object/relation model, roll-up
  inference/           # inference pipeline + AST plugin skeletons
  cli/                 # sync/status/approvals/up commands
  config/              # shared config/github utilities
```

------------------------------------------------------------------------

## 🛠 Tech Stack

-   Next.js (App Router)
-   React + TypeScript
-   Cytoscape.js (graph visualization)
-   PGlite (local Postgres-compatible DB)
-   Radix UI
-   Sonner

------------------------------------------------------------------------

## 🚀 Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Run web in development

```bash
pnpm dev
```

Open your browser at:

    http://localhost:3000

------------------------------------------------------------------------

## 🧑‍💻 CLI Usage

```bash
pnpm cli sync <org>
pnpm cli status
pnpm cli approvals list
pnpm cli approvals apply --all --dry-run
pnpm cli up
```

You can also run the packaged entrypoint:

```bash
npx archi-navi up
```

Example `.env`:

```env
GITHUB_TOKEN=your_token
GITHUB_ORG=your_org
OPENAI_API_KEY=your_openai_key
ARCHI_NAVI_DB_PATH=data/akg-db
```

------------------------------------------------------------------------

## 🗄 Data & Schema

-   Default DB path: `data/akg-db`
-   Env override: `ARCHI_NAVI_DB_PATH` (or `AKG_DB_PATH`)
-   Schema definition: `scripts/schema.sql`

------------------------------------------------------------------------

## 📚 Product Documents

-   PRD: `docs/prd/PRD.md`
-   Spec: `docs/spec/object-model-definition.md`
-   Implementation Spec: `docs/spec/2026-02-20_implementation-spec-core-api.md`
-   Monorepo Transition Tasks: `docs/tasks/2026-02-20_monorepo-transition-task-breakdown.md`

------------------------------------------------------------------------

## 📌 Summary

> Archi.Navi is not static documentation.\
> It is a **practical architecture navigation tool for operating
> microservice systems**.
