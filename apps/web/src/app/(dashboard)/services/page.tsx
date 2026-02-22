/**
 * Object 목록 페이지
 * 데이터는 클라이언트 컴포넌트에서 직접 fetch (워크스페이스 연동)
 */
import type { Metadata } from 'next';
import { ObjectListClient } from '@/components/services/service-list-client';

export const metadata: Metadata = {
  title: 'Object 목록',
};

export default function ServicesPage() {
  return <ObjectListClient />;
}
