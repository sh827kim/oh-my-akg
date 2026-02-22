'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface ServiceType {
    id: number;
    name: string;
    color: string;
    sortOrder: number;
    enabled: boolean;
}

interface TagItem {
    id: string;
    name: string;
    color: string;
}

export default function SettingsPage() {
    const router = useRouter();

    const [types, setTypes] = useState<ServiceType[]>([]);
    const [tags, setTags] = useState<TagItem[]>([]);

    const [loading, setLoading] = useState(true);
    const [savingTypeIds, setSavingTypeIds] = useState<Set<number>>(new Set());
    const [savingTagIds, setSavingTagIds] = useState<Set<string>>(new Set());

    const [newTypeName, setNewTypeName] = useState('');
    const [newTypeColor, setNewTypeColor] = useState('#6b7280');
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#6b7280');

    const [deleteTypeTarget, setDeleteTypeTarget] = useState<ServiceType | null>(null);
    const [deleteTagTarget, setDeleteTagTarget] = useState<TagItem | null>(null);
    const [seedConfirmOpen, setSeedConfirmOpen] = useState(false);
    const [seedLoading, setSeedLoading] = useState(false);

    const sortedTypes = useMemo(
        () => [...types].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
        [types]
    );

    const refreshSettings = async () => {
        try {
            setLoading(true);
            const [typesRes, tagsRes] = await Promise.all([
                fetch('/api/settings/types', { cache: 'no-store' }),
                fetch('/api/settings/tags', { cache: 'no-store' }),
            ]);

            const [typesJson, tagsJson] = await Promise.all([typesRes.json(), tagsRes.json()]);

            if (!typesRes.ok) {
                throw new Error(typesJson.error || '타입 목록 조회 실패');
            }
            if (!tagsRes.ok) {
                throw new Error(tagsJson.error || '태그 목록 조회 실패');
            }

            setTypes(typesJson as ServiceType[]);
            setTags(tagsJson as TagItem[]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '설정 로딩 실패');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshSettings();
    }, []);

    const withSavingType = async (typeId: number, fn: () => Promise<void>) => {
        setSavingTypeIds((prev) => new Set(prev).add(typeId));
        try {
            await fn();
        } finally {
            setSavingTypeIds((prev) => {
                const next = new Set(prev);
                next.delete(typeId);
                return next;
            });
        }
    };

    const withSavingTag = async (tagId: string, fn: () => Promise<void>) => {
        setSavingTagIds((prev) => new Set(prev).add(tagId));
        try {
            await fn();
        } finally {
            setSavingTagIds((prev) => {
                const next = new Set(prev);
                next.delete(tagId);
                return next;
            });
        }
    };

    const patchType = async (typeId: number, patch: Partial<ServiceType>) => {
        const res = await fetch(`/api/settings/types/${typeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(json.error || '타입 저장 실패');
        }
        const updated = json as ServiceType;
        setTypes((prev) => prev.map((item) => (item.id === typeId ? updated : item)));
    };

    const patchTag = async (tagId: string, patch: Partial<TagItem>) => {
        const res = await fetch(`/api/settings/tags/${tagId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(json.error || '태그 저장 실패');
        }
        const updated = json as TagItem;
        setTags((prev) => prev.map((item) => (item.id === tagId ? updated : item)));
    };

    const handleCreateType = async () => {
        if (!newTypeName.trim()) {
            toast.error('타입 이름을 입력하세요.');
            return;
        }

        try {
            const res = await fetch('/api/settings/types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTypeName.trim(), color: newTypeColor }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || '타입 생성 실패');

            setTypes((prev) => [...prev, json as ServiceType]);
            setNewTypeName('');
            setNewTypeColor('#6b7280');
            toast.success('타입이 추가되었습니다.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '타입 생성 실패');
        }
    };

    const handleMoveType = async (typeId: number, direction: -1 | 1) => {
        const ordered = [...sortedTypes];
        const currentIndex = ordered.findIndex((item) => item.id === typeId);
        const nextIndex = currentIndex + direction;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;

        const swapped = [...ordered];
        [swapped[currentIndex], swapped[nextIndex]] = [swapped[nextIndex], swapped[currentIndex]];
        const reassigned = swapped.map((item, idx) => ({ ...item, sortOrder: (idx + 1) * 10 }));

        setTypes(reassigned);

        try {
            await Promise.all(
                reassigned.map((item) =>
                    fetch(`/api/settings/types/${item.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sortOrder: item.sortOrder }),
                    }).then(async (res) => {
                        if (!res.ok) {
                            const json = await res.json().catch(() => ({}));
                            throw new Error(json.error || '순서 저장 실패');
                        }
                    })
                )
            );
            toast.success('레이어 순서를 변경했습니다.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '레이어 순서 저장 실패');
            await refreshSettings();
        }
    };

    const handleDeleteType = async () => {
        if (!deleteTypeTarget) return;

        try {
            await withSavingType(deleteTypeTarget.id, async () => {
                const res = await fetch(`/api/settings/types/${deleteTypeTarget.id}`, { method: 'DELETE' });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json.error || '타입 삭제 실패');
            });

            setTypes((prev) => prev.filter((item) => item.id !== deleteTypeTarget.id));
            toast.success('타입을 삭제했습니다.');
            setDeleteTypeTarget(null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '타입 삭제 실패');
        }
    };

    const handleCreateTag = async () => {
        if (!newTagName.trim()) {
            toast.error('태그 이름을 입력하세요.');
            return;
        }

        try {
            const res = await fetch('/api/settings/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || '태그 생성 실패');

            const created = json as TagItem;
            setTags((prev) => {
                const withoutSame = prev.filter((item) => item.id !== created.id);
                return [...withoutSame, created].sort((a, b) => a.name.localeCompare(b.name));
            });
            setNewTagName('');
            setNewTagColor('#6b7280');
            toast.success('태그가 저장되었습니다.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '태그 생성 실패');
        }
    };

    const handleDeleteTag = async () => {
        if (!deleteTagTarget) return;

        try {
            await withSavingTag(deleteTagTarget.id, async () => {
                const res = await fetch(`/api/settings/tags/${deleteTagTarget.id}`, { method: 'DELETE' });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json.error || '태그 삭제 실패');
            });

            setTags((prev) => prev.filter((item) => item.id !== deleteTagTarget.id));
            toast.success('태그를 삭제했습니다.');
            setDeleteTagTarget(null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '태그 삭제 실패');
        }
    };

    const handleSeedData = async () => {
        setSeedLoading(true);
        try {
            const res = await fetch('/api/seed', { method: 'POST' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                throw new Error(json.error || '데이터 초기화 실패');
            }

            toast.success('샘플 데이터 초기화가 완료되었습니다.');
            setSeedConfirmOpen(false);
            router.refresh();
            await refreshSettings();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '데이터 초기화 실패');
        } finally {
            setSeedLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="mx-auto max-w-5xl space-y-8">
                <div>
                    <h1 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
                        Settings
                    </h1>
                    <p className="mt-2 text-muted-foreground">
                        서비스 Type/Tag를 관리하고 아키텍처 계층 순서를 설정합니다.
                    </p>
                </div>

                <section className="rounded-xl border border-white/5 bg-black/20 p-6 backdrop-blur-md">
                    <div className="mb-5 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-white">Service Types</h2>
                            <p className="text-xs text-gray-500">Top-down 레이어 순서입니다. 위/아래 버튼으로 순서를 바꾸세요.</p>
                        </div>
                    </div>

                    <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_100px]">
                        <input
                            value={newTypeName}
                            onChange={(event) => setNewTypeName(event.target.value)}
                            placeholder="새 타입 이름 (예: batch, gateway)"
                            className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                        />
                        <input
                            type="color"
                            value={newTypeColor}
                            onChange={(event) => setNewTypeColor(event.target.value)}
                            className="h-10 w-full rounded-md border border-white/10 bg-black/40 px-2"
                        />
                        <button
                            onClick={handleCreateType}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            <Plus className="h-4 w-4" /> 추가
                        </button>
                    </div>

                    <div className="space-y-2">
                        {loading && <div className="text-sm text-gray-500">로딩 중...</div>}
                        {!loading && sortedTypes.length === 0 && (
                            <div className="text-sm text-gray-500">등록된 타입이 없습니다.</div>
                        )}
                        {!loading &&
                            sortedTypes.map((type, index) => {
                                const isSaving = savingTypeIds.has(type.id);
                                const isUnknown = type.name === 'unknown';
                                return (
                                    <div
                                        key={type.id}
                                        className="grid grid-cols-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3 md:grid-cols-[40px_1fr_130px_80px_130px]"
                                    >
                                        <div className="flex flex-col gap-1">
                                            <button
                                                onClick={() => handleMoveType(type.id, -1)}
                                                disabled={index === 0 || isSaving}
                                                className="rounded border border-white/10 p-1 text-gray-300 hover:bg-white/10 disabled:opacity-30"
                                                title="위로 이동"
                                            >
                                                <ArrowUp className="mx-auto h-3 w-3" />
                                            </button>
                                            <button
                                                onClick={() => handleMoveType(type.id, 1)}
                                                disabled={index === sortedTypes.length - 1 || isSaving}
                                                className="rounded border border-white/10 p-1 text-gray-300 hover:bg-white/10 disabled:opacity-30"
                                                title="아래로 이동"
                                            >
                                                <ArrowDown className="mx-auto h-3 w-3" />
                                            </button>
                                        </div>

                                        <input
                                            value={type.name}
                                            onChange={(event) => {
                                                const nextName = event.target.value;
                                                setTypes((prev) =>
                                                    prev.map((item) =>
                                                        item.id === type.id ? { ...item, name: nextName } : item
                                                    )
                                                );
                                            }}
                                            onBlur={() => {
                                                void withSavingType(type.id, async () => {
                                                    await patchType(type.id, { name: type.name });
                                                });
                                            }}
                                            disabled={isUnknown || isSaving}
                                            className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none disabled:opacity-50"
                                        />

                                        <input
                                            type="color"
                                            value={type.color}
                                            onChange={(event) => {
                                                const nextColor = event.target.value;
                                                setTypes((prev) =>
                                                    prev.map((item) =>
                                                        item.id === type.id ? { ...item, color: nextColor } : item
                                                    )
                                                );
                                            }}
                                            onBlur={() => {
                                                void withSavingType(type.id, async () => {
                                                    await patchType(type.id, { color: type.color });
                                                });
                                            }}
                                            disabled={isSaving}
                                            className="h-9 w-full rounded border border-white/10 bg-black/40 px-2"
                                        />

                                        <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={type.enabled}
                                                onChange={(event) => {
                                                    const enabled = event.target.checked;
                                                    setTypes((prev) =>
                                                        prev.map((item) =>
                                                            item.id === type.id ? { ...item, enabled } : item
                                                        )
                                                    );
                                                    void withSavingType(type.id, async () => {
                                                        await patchType(type.id, { enabled });
                                                    });
                                                }}
                                                disabled={isUnknown || isSaving}
                                            />
                                            활성화
                                        </label>

                                        <button
                                            onClick={() => setDeleteTypeTarget(type)}
                                            disabled={isUnknown || isSaving}
                                            className="inline-flex items-center justify-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-40"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" /> 삭제
                                        </button>
                                    </div>
                                );
                            })}
                    </div>
                </section>

                <section className="rounded-xl border border-white/5 bg-black/20 p-6 backdrop-blur-md">
                    <h2 className="mb-4 text-xl font-semibold text-white">Tags</h2>

                    <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_100px]">
                        <input
                            value={newTagName}
                            onChange={(event) => setNewTagName(event.target.value)}
                            placeholder="새 태그 이름"
                            className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                        />
                        <input
                            type="color"
                            value={newTagColor}
                            onChange={(event) => setNewTagColor(event.target.value)}
                            className="h-10 w-full rounded-md border border-white/10 bg-black/40 px-2"
                        />
                        <button
                            onClick={handleCreateTag}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            <Plus className="h-4 w-4" /> 추가
                        </button>
                    </div>

                    <div className="space-y-2">
                        {loading && <div className="text-sm text-gray-500">로딩 중...</div>}
                        {!loading && tags.length === 0 && (
                            <div className="text-sm text-gray-500">등록된 태그가 없습니다.</div>
                        )}
                        {!loading &&
                            tags.map((tag) => {
                                const isSaving = savingTagIds.has(tag.id);
                                return (
                                    <div
                                        key={tag.id}
                                        className="grid grid-cols-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3 md:grid-cols-[1fr_130px_120px]"
                                    >
                                        <input
                                            value={tag.name}
                                            onChange={(event) => {
                                                const nextName = event.target.value;
                                                setTags((prev) =>
                                                    prev.map((item) =>
                                                        item.id === tag.id ? { ...item, name: nextName } : item
                                                    )
                                                );
                                            }}
                                            onBlur={() => {
                                                void withSavingTag(tag.id, async () => {
                                                    await patchTag(tag.id, { name: tag.name });
                                                });
                                            }}
                                            disabled={isSaving}
                                            className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
                                        />

                                        <input
                                            type="color"
                                            value={tag.color}
                                            onChange={(event) => {
                                                const nextColor = event.target.value;
                                                setTags((prev) =>
                                                    prev.map((item) =>
                                                        item.id === tag.id ? { ...item, color: nextColor } : item
                                                    )
                                                );
                                            }}
                                            onBlur={() => {
                                                void withSavingTag(tag.id, async () => {
                                                    await patchTag(tag.id, { color: tag.color });
                                                });
                                            }}
                                            disabled={isSaving}
                                            className="h-9 w-full rounded border border-white/10 bg-black/40 px-2"
                                        />

                                        <button
                                            onClick={() => setDeleteTagTarget(tag)}
                                            disabled={isSaving}
                                            className="inline-flex items-center justify-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" /> 삭제
                                        </button>
                                    </div>
                                );
                            })}
                    </div>
                </section>

                <section className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 backdrop-blur-md">
                    <h2 className="mb-4 text-xl font-semibold text-red-400">Danger Zone</h2>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-medium text-white">Reset Database</h3>
                            <p className="text-xs text-gray-500">테이블을 초기화하고 샘플 데이터를 다시 생성합니다.</p>
                        </div>
                        <button
                            onClick={() => setSeedConfirmOpen(true)}
                            className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
                        >
                            Reset & Seed
                        </button>
                    </div>
                </section>
            </div>

            <ConfirmDialog
                open={Boolean(deleteTypeTarget)}
                title="타입 삭제"
                description={
                    deleteTypeTarget
                        ? `"${deleteTypeTarget.name}" 타입을 삭제할까요? 기존 서비스 타입은 unknown으로 변경됩니다.`
                        : undefined
                }
                destructive
                confirmText="삭제"
                onOpenChange={(open) => {
                    if (!open) setDeleteTypeTarget(null);
                }}
                onConfirm={handleDeleteType}
            />

            <ConfirmDialog
                open={Boolean(deleteTagTarget)}
                title="태그 삭제"
                description={
                    deleteTagTarget
                        ? `"${deleteTagTarget.name}" 태그를 삭제할까요? 서비스에 연결된 태그도 함께 제거됩니다.`
                        : undefined
                }
                destructive
                confirmText="삭제"
                onOpenChange={(open) => {
                    if (!open) setDeleteTagTarget(null);
                }}
                onConfirm={handleDeleteTag}
            />

            <ConfirmDialog
                open={seedConfirmOpen}
                title="데이터베이스 초기화"
                description="현재 데이터를 초기화하고 샘플 데이터를 다시 생성합니다. 계속할까요?"
                destructive
                loading={seedLoading}
                confirmText="Reset & Seed"
                onOpenChange={setSeedConfirmOpen}
                onConfirm={handleSeedData}
            />
        </div>
    );
}
