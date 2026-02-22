/**
 * 관계 매핑 페이지 (/relations)
 * 클라이언트 컴포넌트로 위임 — workspaceId 연동 + 수동 관계 등록
 */
import type { Metadata } from 'next';
import { RelationsClient } from '@/components/relations/relations-client';

export const metadata: Metadata = { title: '관계 매핑' };

export default function RelationsPage() {
  return <RelationsClient />;
}
