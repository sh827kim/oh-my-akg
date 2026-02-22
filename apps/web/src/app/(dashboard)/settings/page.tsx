/**
 * 설정 페이지 — 탭 기반 구성
 * 일반 | 레이어 관리 | AI 설정 | 추론/Rollup 설정
 */
import type { Metadata } from 'next';
import { SettingsClient } from '@/components/settings/settings-client';

export const metadata: Metadata = {
  title: '설정',
};

export default function SettingsPage() {
  return <SettingsClient />;
}
