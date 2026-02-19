import { NextResponse } from 'next/server';
import { getDb, initSchema } from '@/lib/db';

export async function POST() {
    const db = await getDb();

    try {
        // 0. Ensure Schema Exists
        await initSchema();

        // 1. Validate environment (Safety check)
        // In a real app, check for Auth or specific ENV var.

        // 2. Clear existing data
        await db.query('DELETE FROM edges');
        await db.query('DELETE FROM projects');

        // 3. Seed Projects
        const projects = [
            // Frontend
            { id: 'p1', repo_name: 'web-dashboard', type: 'frontend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/web-dashboard' },
            { id: 'p2', repo_name: 'mobile-app-ios', type: 'frontend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/mobile-app-ios' },
            { id: 'p3', repo_name: 'admin-portal', type: 'frontend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/admin-portal' },
            { id: 'p4', repo_name: 'landing-page', type: 'frontend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/landing-page' },

            // Backend
            { id: 'p5', repo_name: 'api-gateway', type: 'backend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/api-gateway' },
            { id: 'p6', repo_name: 'auth-service', type: 'backend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/auth-service' },
            { id: 'p7', repo_name: 'payment-service', type: 'backend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/payment-service' },
            { id: 'p8', repo_name: 'user-service', type: 'backend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/user-service' },
            { id: 'p9', repo_name: 'order-service', type: 'backend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/order-service' },
            { id: 'p10', repo_name: 'notification-service', type: 'backend', visibility: 'VISIBLE', repo_url: 'https://github.com/org/notification-service' },

            // Middleware / Infra
            { id: 'p11', repo_name: 'kafka-cluster', type: 'middleware', visibility: 'VISIBLE', repo_url: 'https://github.com/org/kafka-cluster' },
            { id: 'p12', repo_name: 'redis-cache', type: 'middleware', visibility: 'VISIBLE', repo_url: 'https://github.com/org/redis-cache' },
            { id: 'p13', repo_name: 'postgres-primary', type: 'database', visibility: 'VISIBLE', repo_url: 'https://github.com/org/postgres-primary' },
            { id: 'p14', repo_name: 'elasticsearch', type: 'middleware', visibility: 'VISIBLE', repo_url: 'https://github.com/org/elasticsearch' },
        ];

        for (const p of projects) {
            await db.query(
                "INSERT INTO projects (id, repo_name, type, visibility, repo_url, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())",
                [p.id, p.repo_name, p.type, p.visibility, p.repo_url]
            );
        }

        // 4. Seed Edges
        const edges = [
            // Frontend -> Gateway
            { source: 'p1', target: 'p5', type: 'http' },
            { source: 'p2', target: 'p5', type: 'http' },
            { source: 'p3', target: 'p5', type: 'http' },

            // Gateway -> Services
            { source: 'p5', target: 'p6', type: 'grpc' },
            { source: 'p5', target: 'p7', type: 'grpc' },
            { source: 'p5', target: 'p8', type: 'grpc' },
            { source: 'p5', target: 'p9', type: 'grpc' },

            // Services -> DB/Cache
            { source: 'p6', target: 'p13', type: 'sql' }, // Auth -> DB
            { source: 'p6', target: 'p12', type: 'redis' }, // Auth -> Redis
            { source: 'p8', target: 'p13', type: 'sql' }, // User -> DB

            // Services -> Kafka
            { source: 'p7', target: 'p11', type: 'kafka' }, // Payment -> Kafka
            { source: 'p9', target: 'p11', type: 'kafka' }, // Order -> Kafka
            { source: 'p11', target: 'p10', type: 'kafka' }, // Kafka -> Notification
        ];

        for (const e of edges) {
            await db.query(
                "INSERT INTO edges (from_id, to_id, type) VALUES ($1, $2, $3)",
                [e.source, e.target, e.type]
            );
        }

        return NextResponse.json({ success: true, message: "Sample data seeded successfully" });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
