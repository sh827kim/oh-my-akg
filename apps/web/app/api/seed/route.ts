import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb, initSchema } from '@archi-navi/core';

export async function POST() {
  const db = await getDb();

  try {
    await initSchema();

    await db.query('DELETE FROM object_relations');
    await db.query('DELETE FROM object_tags');
    await db.query(`DELETE FROM objects WHERE object_type = 'service'`);

    const projects = [
      { urn: 'org/web-dashboard', repo_name: 'web-dashboard', project_type: 'frontend', repo_url: 'https://github.com/org/web-dashboard' },
      { urn: 'org/mobile-app-ios', repo_name: 'mobile-app-ios', project_type: 'frontend', repo_url: 'https://github.com/org/mobile-app-ios' },
      { urn: 'org/admin-portal', repo_name: 'admin-portal', project_type: 'frontend', repo_url: 'https://github.com/org/admin-portal' },
      { urn: 'org/landing-page', repo_name: 'landing-page', project_type: 'frontend', repo_url: 'https://github.com/org/landing-page' },
      { urn: 'org/api-gateway', repo_name: 'api-gateway', project_type: 'backend', repo_url: 'https://github.com/org/api-gateway' },
      { urn: 'org/auth-service', repo_name: 'auth-service', project_type: 'backend', repo_url: 'https://github.com/org/auth-service' },
      { urn: 'org/payment-service', repo_name: 'payment-service', project_type: 'backend', repo_url: 'https://github.com/org/payment-service' },
      { urn: 'org/user-service', repo_name: 'user-service', project_type: 'backend', repo_url: 'https://github.com/org/user-service' },
      { urn: 'org/order-service', repo_name: 'order-service', project_type: 'backend', repo_url: 'https://github.com/org/order-service' },
      { urn: 'org/notification-service', repo_name: 'notification-service', project_type: 'backend', repo_url: 'https://github.com/org/notification-service' },
      { urn: 'org/kafka-cluster', repo_name: 'kafka-cluster', project_type: 'middleware', repo_url: 'https://github.com/org/kafka-cluster' },
      { urn: 'org/redis-cache', repo_name: 'redis-cache', project_type: 'middleware', repo_url: 'https://github.com/org/redis-cache' },
      { urn: 'org/postgres-primary', repo_name: 'postgres-primary', project_type: 'database', repo_url: 'https://github.com/org/postgres-primary' },
      { urn: 'org/elasticsearch', repo_name: 'elasticsearch', project_type: 'middleware', repo_url: 'https://github.com/org/elasticsearch' },
    ] as const;

    const objectIdByUrn = new Map<string, string>();

    for (const p of projects) {
      const objectId = randomUUID();
      objectIdByUrn.set(p.urn, objectId);
      await db.query(
        `INSERT INTO objects
         (id, workspace_id, object_type, name, display_name, urn, visibility, granularity, metadata)
         VALUES ($1, 'default', 'service', $2, NULL, $3, 'VISIBLE', 'COMPOUND', $4::jsonb)`,
        [
          objectId,
          p.repo_name,
          p.urn,
          JSON.stringify({
            repo_url: p.repo_url,
            project_type: p.project_type,
            status: 'ACTIVE',
          }),
        ],
      );
    }

    const relations = [
      { source: 'org/web-dashboard', target: 'org/api-gateway', type: 'call' },
      { source: 'org/mobile-app-ios', target: 'org/api-gateway', type: 'call' },
      { source: 'org/admin-portal', target: 'org/api-gateway', type: 'call' },
      { source: 'org/api-gateway', target: 'org/auth-service', type: 'call' },
      { source: 'org/api-gateway', target: 'org/payment-service', type: 'call' },
      { source: 'org/api-gateway', target: 'org/user-service', type: 'call' },
      { source: 'org/api-gateway', target: 'org/order-service', type: 'call' },
      { source: 'org/auth-service', target: 'org/postgres-primary', type: 'read' },
      { source: 'org/auth-service', target: 'org/redis-cache', type: 'read' },
      { source: 'org/user-service', target: 'org/postgres-primary', type: 'write' },
      { source: 'org/payment-service', target: 'org/kafka-cluster', type: 'produce' },
      { source: 'org/order-service', target: 'org/kafka-cluster', type: 'produce' },
      { source: 'org/kafka-cluster', target: 'org/notification-service', type: 'consume' },
    ] as const;

    for (const r of relations) {
      const sourceId = objectIdByUrn.get(r.source);
      const targetId = objectIdByUrn.get(r.target);
      if (!sourceId || !targetId) continue;

      await db.query(
        `INSERT INTO object_relations
         (id, workspace_id, subject_object_id, relation_type, target_object_id, approved, is_derived, source, evidence)
         VALUES ($1, 'default', $2, $3, $4, TRUE, FALSE, 'manual', '[]'::jsonb)`,
        [randomUUID(), sourceId, r.type, targetId],
      );
    }

    return NextResponse.json({ success: true, message: 'Sample data seeded successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
