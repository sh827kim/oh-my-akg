/**
 * workspace-context.tsx — Zustand 전환 후 하위 호환 shim
 *
 * 실제 상태 로직은 @/stores/workspace 로 이전했고,
 * 이 파일은 기존 import 경로(@/contexts/workspace-context)를 유지하기 위한 re-export.
 *
 * ── 변경 전 ──────────────────────────────────────
 *   React Context + useState + localStorage 직접 접근
 *   → Provider가 상태를 소유하고 useContext로 전달
 *
 * ── 변경 후 ──────────────────────────────────────
 *   Zustand store(@/stores/workspace)가 상태 소유
 *   → Provider 불필요, 어디서든 useWorkspaceStore() 직접 호출 가능
 *   → WorkspaceProvider는 앱 시작 시 refreshWorkspaces()만 실행하는 초기화 컴포넌트
 * ────────────────────────────────────────────────
 *
 * 기존 사용 코드는 변경 없이 동작:
 *   import { useWorkspace } from '@/contexts/workspace-context'
 *   const { workspaceId, setWorkspace } = useWorkspace()
 */
'use client';

import { useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspace';

/* ─── 타입 re-export (기존 import 유지) ─── */
export type { WorkspaceItem } from '@/stores/workspace';

/* ─── 훅 re-export ─── */
export { useWorkspaceStore as useWorkspace } from '@/stores/workspace';

/* ─── WorkspaceProvider ─────────────────────────────────────────────────────
 * Zustand는 Provider가 필요 없지만,
 * layout.tsx의 <WorkspaceProvider> 래핑을 유지하면서
 * 앱 마운트 시 워크스페이스 목록을 한 번 fetch하는 역할을 담당.
 *
 * SSR hydration mismatch 문제:
 *   - 기존: mounted state로 클라이언트 전용 렌더링 분기
 *   - 현재: Zustand persist가 클라이언트에서만 실행되므로 자동 안전
 * ─────────────────────────────────────────────────────────────────────────── */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const refreshWorkspaces = useWorkspaceStore((s) => s.refreshWorkspaces);

  // 앱 시작 시 워크스페이스 목록 초기 로드
  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  return <>{children}</>;
}
