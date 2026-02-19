# OH-MY-AKG

[한국어](README.ko.md)

> A Living Architecture Map for MSA Teams\
> *Stop guessing your system. Start seeing it clearly.*

------------------------------------------------------------------------

## 🚨 The Challenge

Operating microservices often raises difficult questions:

-   Which services depend on this one?
-   Why did a small change cause unexpected failures elsewhere?
-   Is the architecture document still accurate?
-   How many people truly understand the entire system?

Microservice architectures evolve faster than documentation.

OH-MY-AKG addresses this gap by transforming your GitHub organization
into a **live, explorable architecture map** --- helping teams
understand, analyze, and share their system structure with confidence.

------------------------------------------------------------------------

## 🧭 What OH-MY-AKG Provides

OH-MY-AKG analyzes repositories within your GitHub organization and
delivers:

-   🔍 A searchable service overview
-   🔗 A dependency graph with inbound/outbound visibility
-   🏗 A layered architecture view
-   🏷 Team-driven classification (Type, Tag, Alias, Visibility)
-   📤 CSV and PNG export capabilities

It is not a static documentation tool --- it is an operational
visibility tool for real-world MSA environments.

------------------------------------------------------------------------

## ✨ Key Features

### 1. Overview

-   Project list with search
-   Alias / Type / Visibility management
-   Tag creation and editing
-   CSV export

This allows teams to align on a shared structural language.

------------------------------------------------------------------------

### 2. Dependency Graph

-   Interactive visualization of service dependencies
-   Inbound / Outbound relationship inspection
-   Search-based node highlighting
-   Right-click hide (HIDDEN)

This makes impact analysis before release significantly easier.

------------------------------------------------------------------------

### 3. Architecture View

-   Type-based top-down layered structure
-   Edge-type filtering (All + dynamic types)
-   PNG export

Provides a clear structural perspective for architectural discussions.

------------------------------------------------------------------------

### 4. Settings

-   Create / update / reorder Types
-   Create / update / delete Tags

The classification model is flexible and evolves with your team.

------------------------------------------------------------------------

## ✅ Who Should Use This

-   Teams actively operating MSA environments
-   Organizations managing multiple repositories
-   Backend / platform teams requiring impact analysis
-   Companies with high onboarding complexity
-   Projects where keeping documentation up to date is difficult

If your architecture must be explainable and operationally visible, this
tool is designed for you.

------------------------------------------------------------------------

## 🛠 Tech Stack

-   Next.js (App Router)
-   React + TypeScript
-   Cytoscape.js (Graph visualization)
-   PGlite (Local Postgres-compatible DB)
-   Radix UI
-   Sonner

------------------------------------------------------------------------

## 🚀 Getting Started

### 1. Install dependencies

``` bash
pnpm install
```

### 2. Start development server

``` bash
pnpm dev
```

Open your browser at:

    http://localhost:3000

------------------------------------------------------------------------

## 🧑‍💻 CLI Usage

``` bash
pnpm cli sync <org>
pnpm cli status
```

Example `.env` configuration:

``` env
GITHUB_TOKEN=your_token
GITHUB_ORG=your_org
OPENAI_API_KEY=your_openai_key
```

------------------------------------------------------------------------

## 🗄 Data & Schema

-   Database file: `data/akg-db`
-   Schema definition: `scripts/schema.sql`

------------------------------------------------------------------------

## 🔮 Roadmap

-   Approval workflow (change_request)
-   Advanced middleware relationship modeling
-   Kafka View
-   draw.io export support
-   Agent Chat RAG enhancement
-   Dockerized deployment support

------------------------------------------------------------------------

## 📌 Summary

> OH-MY-AKG is not documentation.\
> It is a **practical architecture map for operating microservices
> systems.**
