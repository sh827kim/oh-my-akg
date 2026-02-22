/**
 * WorkspaceContext
 * 현재 선택된 워크스페이스 ID를 전역 상태로 관리
 * localStorage에 유지하여 새로고침 후에도 보존
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { DEFAULT_WORKSPACE_ID } from '@archi-navi/shared';

/* ─── 타입 ─── */
export interface WorkspaceItem {
  id: string;
  name: string;
  createdAt: string;
}

interface WorkspaceContextValue {
  /** 현재 선택된 워크스페이스 ID */
  workspaceId: string;
  /** 현재 워크스페이스 이름 */
  workspaceName: string;
  /** 전체 워크스페이스 목록 */
  workspaces: WorkspaceItem[];
  /** 워크스페이스 전환 */
  setWorkspace: (id: string) => void;
  /** 목록 새로고침 */
  refreshWorkspaces: () => Promise<void>;
}

const STORAGE_KEY = 'archi-navi:workspace-id';

/* ─── Context ─── */
const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaceId: DEFAULT_WORKSPACE_ID,
  workspaceName: 'Default Workspace',
  workspaces: [],
  setWorkspace: () => {},
  refreshWorkspaces: async () => {},
});

/* ─── Provider ─── */
export function WorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // localStorage에서 초기값 복원 (SSR에서는 기본값 사용)
  const [workspaceId, setWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [mounted, setMounted] = useState(false);

  // 현재 워크스페이스 이름 계산
  const workspaceName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? 'Default Workspace';

  // 워크스페이스 목록 fetch
  const refreshWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/workspaces');
      if (!res.ok) return;
      const data = (await res.json()) as WorkspaceItem[];
      setWorkspaces(data);

      // 저장된 워크스페이스가 목록에 없으면 기본값으로 복원
      const saved = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_WORKSPACE_ID;
      const found = data.find((w) => w.id === saved);
      setWorkspaceId(found ? saved : DEFAULT_WORKSPACE_ID);
    } catch {
      console.error('[WorkspaceContext] 워크스페이스 목록 로드 실패');
    }
  }, []);

  // 클라이언트 마운트 후 localStorage 읽기
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setWorkspaceId(saved);
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  // 워크스페이스 전환
  const setWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // SSR hydration mismatch 방지
  if (!mounted) {
    return (
      <WorkspaceContext.Provider
        value={{
          workspaceId: DEFAULT_WORKSPACE_ID,
          workspaceName: 'Default Workspace',
          workspaces: [],
          setWorkspace,
          refreshWorkspaces,
        }}
      >
        {children}
      </WorkspaceContext.Provider>
    );
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceId,
        workspaceName,
        workspaces,
        setWorkspace,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

/* ─── Hook ─── */
export function useWorkspace() {
  return useContext(WorkspaceContext);
}
