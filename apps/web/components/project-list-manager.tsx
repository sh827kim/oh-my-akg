'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Edit2,
    Eye,
    EyeOff,
    MoreHorizontal,
    X,
    Trash,
    RefreshCw,
    Layers,
    Filter,
    BadgeInfo,
    PlusCircle,
} from 'lucide-react';
import { ViewToggle } from '@/components/view-toggle';
import { TagManager } from '@/components/tag-manager';
import { ServiceDetailModal } from '@/components/project-detail-modal';
import { CsvExportButton } from '@/components/csv-export-button';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Tag {
    id: string;
    name: string;
    color: string;
}

interface ProjectType {
    id: number;
    name: string;
    color: string;
    sortOrder: number;
    enabled: boolean;
}

interface Project {
    id: string;
    repo_name: string;
    alias: string | null;
    description: string | null;
    type: string;
    visibility: string;
    status: string;
    updated_at: string;
    last_seen_at: string | null;
    inbound_count: number;
    outbound_count: number;
    tags: Tag[];
}

interface ServiceListManagerProps {
    initialProjects: Project[];
    availableTags: Tag[];
    projectTypes: ProjectType[];
    viewMode: 'card' | 'list';
}

function getTypeStyle(type: string, types: ProjectType[]) {
    const entry = types.find((item) => item.name === type);
    const color = entry?.color ?? '#6b7280';
    return {
        color,
        backgroundColor: `${color}1A`,
        borderColor: `${color}66`,
    };
}

export function ServiceListManager({
    initialProjects,
    availableTags,
    projectTypes,
    viewMode,
}: ServiceListManagerProps) {
    const [isEditMode, setIsEditMode] = useState(false);
    const [showHidden, setShowHidden] = useState(false);
    const [projects, setProjects] = useState(initialProjects);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

    const [syncOpen, setSyncOpen] = useState(false);
    const [syncOrg, setSyncOrg] = useState('');
    const [syncLoading, setSyncLoading] = useState(false);

    const [addOpen, setAddOpen] = useState(false);
    const [addLoading, setAddLoading] = useState(false);
    const [newRepoName, setNewRepoName] = useState('');
    const [newAlias, setNewAlias] = useState('');
    const [newType, setNewType] = useState(
        projectTypes.find((item) => item.enabled)?.name || 'unknown'
    );

    const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const router = useRouter();
    const searchParams = useSearchParams();
    const searchQuery = searchParams.get('q')?.toLowerCase().trim() || '';

    const enabledTypeNames = useMemo(
        () => projectTypes.filter((item) => item.enabled).map((item) => item.name),
        [projectTypes]
    );
    const selectableTypeNames = useMemo(() => {
        if (enabledTypeNames.length > 0) return enabledTypeNames;
        return ['unknown'];
    }, [enabledTypeNames]);

    useEffect(() => {
        if (!selectableTypeNames.includes(newType)) {
            setNewType(selectableTypeNames[0]);
        }
    }, [newType, selectableTypeNames]);

    const filteredProjects = useMemo(() => {
        return projects.filter((project) => {
            if (!showHidden && project.visibility === 'HIDDEN') return false;
            if (!searchQuery) return true;

            const tagsText = project.tags.map((tag) => tag.name.toLowerCase()).join(' ');
            return (
                project.repo_name.toLowerCase().includes(searchQuery) ||
                (project.alias || '').toLowerCase().includes(searchQuery) ||
                project.type.toLowerCase().includes(searchQuery) ||
                tagsText.includes(searchQuery)
            );
        });
    }, [projects, searchQuery, showHidden]);

    const csvRows = useMemo(() => {
        return filteredProjects.map((project) => ({
            repo_name: project.repo_name,
            alias: project.alias || '',
            type: project.type,
            visibility: project.visibility,
            status: project.status,
            tags: project.tags.map((tag) => tag.name).join('|'),
            inbound_count: project.inbound_count,
            outbound_count: project.outbound_count,
            last_seen_at: project.last_seen_at || '',
            updated_at: project.updated_at,
        }));
    }, [filteredProjects]);

    const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
    const selectedProjectTags = selectedProject?.tags || [];

    const updateProjectInState = (id: string, patch: Partial<Project>) => {
        setProjects((prev) => prev.map((project) => (project.id === id ? { ...project, ...patch } : project)));
    };

    const patchProject = async (id: string, patch: Record<string, string>) => {
        const res = await fetch('/api/objects', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...patch }),
        });
        if (!res.ok) {
            const errorJson = await res.json().catch(() => ({}));
            throw new Error(errorJson.error || '서비스 수정 실패');
        }
        return res.json();
    };

    const toggleVisibility = async (project: Project) => {
        const nextVisibility = project.visibility === 'VISIBLE' ? 'HIDDEN' : 'VISIBLE';
        const prevVisibility = project.visibility;
        updateProjectInState(project.id, { visibility: nextVisibility });

        try {
            await patchProject(project.id, { visibility: nextVisibility });
            toast.success('Visibility updated');
        } catch (error) {
            updateProjectInState(project.id, { visibility: prevVisibility });
            toast.error(error instanceof Error ? error.message : 'Visibility update failed');
        }
    };

    const handleTypeChange = async (project: Project, nextType: string) => {
        const prevType = project.type;
        updateProjectInState(project.id, { type: nextType });
        try {
            await patchProject(project.id, { type: nextType });
            toast.success('Service type updated');
        } catch (error) {
            updateProjectInState(project.id, { type: prevType });
            toast.error(error instanceof Error ? error.message : 'Type update failed');
        }
    };

    const handleAliasSave = async (project: Project, nextAlias: string) => {
        const normalized = nextAlias.trim();
        const prevAlias = project.alias || '';
        if (prevAlias === normalized) return;

        updateProjectInState(project.id, { alias: normalized || null });
        try {
            await patchProject(project.id, { alias: normalized });
            toast.success('Alias updated');
        } catch (error) {
            updateProjectInState(project.id, { alias: prevAlias || null });
            toast.error(error instanceof Error ? error.message : 'Alias update failed');
        }
    };

    const handleAddTag = async (projectId: string, tagId: string) => {
        try {
            const res = await fetch(`/api/objects/${encodeURIComponent(projectId)}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tagId }),
            });
            if (!res.ok) {
                const errorJson = await res.json().catch(() => ({}));
                throw new Error(errorJson.error || '태그 추가 실패');
            }

            const tag = (await res.json()) as Tag;
            setProjects((prev) =>
                prev.map((project) => {
                    if (project.id !== projectId) return project;
                    if (project.tags.some((t) => t.id === tag.id)) return project;
                    return { ...project, tags: [...project.tags, tag] };
                })
            );
            toast.success('Tag added');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Tag add failed');
        }
    };

    const handleRemoveTag = async (projectId: string, tagId: string) => {
        try {
            const res = await fetch(`/api/objects/${encodeURIComponent(projectId)}/tags`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tagId }),
            });
            if (!res.ok) {
                const errorJson = await res.json().catch(() => ({}));
                throw new Error(errorJson.error || '태그 삭제 실패');
            }

            setProjects((prev) =>
                prev.map((project) =>
                    project.id === projectId
                        ? { ...project, tags: project.tags.filter((tag) => tag.id !== tagId) }
                        : project
                )
            );
            toast.success('Tag removed');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Tag remove failed');
        }
    };

    const handleProjectClick = (projectId: string) => {
        if (!isEditMode) setSelectedProjectId(projectId);
    };

    const runSync = async () => {
        setSyncLoading(true);
        try {
            const res = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org: syncOrg.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Sync failed');

            toast.success(`Sync complete (new: ${json.created}, updated: ${json.updated}, deleted: ${json.deleted})`);
            setSyncOpen(false);
            setSyncOrg('');
            router.refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Sync failed');
        } finally {
            setSyncLoading(false);
        }
    };

    const runAddProject = async () => {
        if (!newRepoName.trim()) {
            toast.error('repo_name is required');
            return;
        }
        setAddLoading(true);
        try {
            const res = await fetch('/api/objects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repo_name: newRepoName.trim(),
                    alias: newAlias.trim(),
                    type: newType,
                    visibility: 'VISIBLE',
                    description: 'Manually added service',
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Service creation failed');

            const createdProject: Project = {
                ...json,
                description: 'Manually added service',
                last_seen_at: null,
                inbound_count: 0,
                outbound_count: 0,
                tags: [],
            };
            setProjects((prev) => [createdProject, ...prev]);

            setAddOpen(false);
            setNewRepoName('');
            setNewAlias('');
            setNewType(selectableTypeNames[0]);
            toast.success('New service added');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Service creation failed');
        } finally {
            setAddLoading(false);
        }
    };

    const runDeleteProject = async () => {
        if (!deleteTarget) return;
        setDeleteLoading(true);
        try {
            const res = await fetch(`/api/objects?id=${encodeURIComponent(deleteTarget.id)}`, {
                method: 'DELETE',
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Delete failed');

            setProjects((prev) => prev.filter((project) => project.id !== deleteTarget.id));
            if (selectedProjectId === deleteTarget.id) setSelectedProjectId(null);
            setDeleteTarget(null);
            toast.success('Service marked as deleted');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Delete failed');
        } finally {
            setDeleteLoading(false);
        }
    };

    const handleManageDependencies = (id: string) => {
        toast.info(`Dependencies editor for ${id} will be implemented next`);
    };

    return (
        <>
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
                        Services
                    </h1>
                    <p className="mt-2 text-muted-foreground">
                        Manage services, visibility, tags, aliases and synchronization
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <ViewToggle currentView={viewMode} />
                    <button
                        onClick={() => setShowHidden((prev) => !prev)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${showHidden
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                            }`}
                    >
                        <Filter className="h-4 w-4" />
                        <span>{showHidden ? 'HIDDEN 포함' : 'HIDDEN 제외'}</span>
                    </button>
                    <CsvExportButton data={csvRows} filename="services.csv" />
                    <button
                        onClick={() => setSyncOpen(true)}
                        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
                    >
                        Sync Now
                    </button>
                    <button
                        onClick={() => setAddOpen(true)}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        Add Service
                    </button>
                </div>
            </div>

            <ServiceDetailModal
                project={selectedProject}
                isOpen={Boolean(selectedProject)}
                onClose={() => setSelectedProjectId(null)}
                tags={selectedProjectTags}
            />

            {viewMode === 'card' ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredProjects.map((project) => {
                        const displayName = project.alias?.trim() ? project.alias : project.repo_name;
                        const typeStyle = getTypeStyle(project.type, projectTypes);
                        return (
                            <div
                                key={project.id}
                                onClick={() => handleProjectClick(project.id)}
                                className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-black/20 p-6 transition-all duration-300 backdrop-blur-md ${project.visibility === 'HIDDEN'
                                    ? 'border-white/5 opacity-50'
                                    : 'border-white/5 hover:border-primary/50 hover:shadow-[0_0_20px_rgba(139,92,246,0.1)]'
                                    }`}
                            >
                                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                                <div className="relative z-10">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10"
                                                style={{ backgroundColor: `${typeStyle.color}1A`, color: typeStyle.color }}
                                            >
                                                <code className="text-lg font-bold">{project.type[0]?.toUpperCase() || '?'}</code>
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-white transition-colors group-hover:text-primary">
                                                    {displayName}
                                                </h3>
                                                <p className="text-xs text-muted-foreground">{project.repo_name}</p>
                                            </div>
                                        </div>
                                        <span
                                            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${project.visibility === 'VISIBLE'
                                                ? 'bg-green-400/10 text-green-400 ring-green-400/20'
                                                : 'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                                                }`}
                                        >
                                            {project.visibility}
                                        </span>
                                    </div>

                                    <div className="mt-4 text-xs text-gray-400">
                                        Inbound {project.inbound_count} / Outbound {project.outbound_count}
                                    </div>

                                    <div className="mt-6" onClick={(event) => event.stopPropagation()}>
                                        <TagManager
                                            tags={project.tags}
                                            availableTags={availableTags}
                                            isEditMode={isEditMode}
                                            onAddTag={(tagId) => handleAddTag(project.id, tagId)}
                                            onRemoveTag={(tagId) => handleRemoveTag(project.id, tagId)}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {filteredProjects.length === 0 && (
                        <div className="col-span-full py-12 text-center text-gray-500">
                            조건에 맞는 서비스가 없습니다.
                        </div>
                    )}
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-white/5 bg-black/20 pb-12 backdrop-blur-md">
                    <div className="flex items-center justify-between border-b border-white/10 p-4">
                        <span className="text-sm text-gray-400">Total {filteredProjects.length} Services</span>
                        <button
                            onClick={() => setIsEditMode((prev) => !prev)}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${isEditMode
                                ? 'border border-primary/30 bg-primary/20 text-primary'
                                : 'border border-transparent bg-white/5 text-gray-300 hover:bg-white/10'
                                }`}
                        >
                            {isEditMode ? <X className="h-3 w-3" /> : <Edit2 className="h-3 w-3" />}
                            {isEditMode ? 'Exit Edit Mode' : 'Edit Mode'}
                        </button>
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-white/5 text-gray-400">
                            <tr>
                                <th className="px-6 py-3 font-medium">Name / Alias</th>
                                <th className="px-6 py-3 font-medium">Type</th>
                                <th className="px-6 py-3 font-medium">Visibility</th>
                                <th className="px-6 py-3 font-medium">Tags</th>
                                <th className="px-6 py-3 font-medium">In / Out</th>
                                <th className="px-6 py-3 font-medium">Updated</th>
                                <th className="px-6 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredProjects.map((project) => {
                                const style = getTypeStyle(project.type, projectTypes);
                                return (
                                    <tr
                                        key={project.id}
                                        onClick={() => handleProjectClick(project.id)}
                                        className="cursor-pointer transition-colors hover:bg-white/5"
                                    >
                                        <td className="px-6 py-4 font-medium text-white" onClick={(event) => event.stopPropagation()}>
                                            <div className="flex flex-col gap-1">
                                                <span>{project.repo_name}</span>
                                                {isEditMode ? (
                                                    <input
                                                        defaultValue={project.alias || ''}
                                                        placeholder="alias"
                                                        className="w-48 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white focus:border-primary focus:outline-none"
                                                        onBlur={(event) => handleAliasSave(project, event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                const target = event.target as HTMLInputElement;
                                                                handleAliasSave(project, target.value);
                                                                target.blur();
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="text-xs text-gray-500">
                                                        {project.alias?.trim() ? `alias: ${project.alias}` : 'alias: -'}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>
                                            {isEditMode ? (
                                                <select
                                                    value={project.type}
                                                    onChange={(event) => handleTypeChange(project, event.target.value)}
                                                    className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white focus:border-primary focus:outline-none"
                                                >
                                                    {[...new Set([project.type, ...selectableTypeNames])].map((typeName) => (
                                                        <option key={typeName} value={typeName}>
                                                            {typeName}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span
                                                    className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium"
                                                    style={style}
                                                >
                                                    {project.type}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>
                                            <button
                                                disabled={!isEditMode}
                                                onClick={() => toggleVisibility(project)}
                                                className={`inline-flex items-center gap-1.5 transition-colors ${isEditMode ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                                                    } ${project.visibility === 'VISIBLE' ? 'text-green-400' : 'text-gray-500'
                                                    }`}
                                            >
                                                {project.visibility === 'VISIBLE' ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                                                {project.visibility}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>
                                            <TagManager
                                                tags={project.tags}
                                                availableTags={availableTags}
                                                isEditMode={isEditMode}
                                                onAddTag={(tagId) => handleAddTag(project.id, tagId)}
                                                onRemoveTag={(tagId) => handleRemoveTag(project.id, tagId)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 text-gray-300">
                                            {project.inbound_count} / {project.outbound_count}
                                        </td>
                                        <td className="px-6 py-4 text-gray-400">
                                            {new Date(project.updated_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 text-right" onClick={(event) => event.stopPropagation()}>
                                            <DropdownMenu.Root>
                                                <DropdownMenu.Trigger asChild>
                                                    <button className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </button>
                                                </DropdownMenu.Trigger>
                                                <DropdownMenu.Portal>
                                                    <DropdownMenu.Content className="z-50 min-w-[170px] rounded-md border border-white/10 bg-[#1a1a1a] p-1 text-sm text-gray-300 shadow-xl">
                                                        <DropdownMenu.Item
                                                            className="cursor-pointer rounded px-2 py-1.5 outline-none hover:bg-primary/20 hover:text-white"
                                                            onClick={() => handleManageDependencies(project.id)}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Layers className="h-4 w-4" />
                                                                Dependencies
                                                            </span>
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Item
                                                            className="cursor-pointer rounded px-2 py-1.5 outline-none hover:bg-primary/20 hover:text-white"
                                                            onClick={() => setSyncOpen(true)}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <RefreshCw className="h-4 w-4" />
                                                                Sync
                                                            </span>
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
                                                        <DropdownMenu.Item
                                                            className="cursor-pointer rounded px-2 py-1.5 text-red-400 outline-none hover:bg-red-500/20 hover:text-red-400"
                                                            onClick={() => setDeleteTarget(project)}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Trash className="h-4 w-4" />
                                                                Delete
                                                            </span>
                                                        </DropdownMenu.Item>
                                                    </DropdownMenu.Content>
                                                </DropdownMenu.Portal>
                                            </DropdownMenu.Root>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredProjects.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center text-gray-500">
                                        조건에 맞는 서비스가 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                <BadgeInfo className="h-3 w-3" />
                <span>편집 모드에서 visibility/type/alias/tag 변경이 DB에 즉시 반영됩니다.</span>
            </div>

            <Dialog.Root open={syncOpen} onOpenChange={setSyncOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#101217] p-5 shadow-2xl focus:outline-none">
                        <Dialog.Title className="text-lg font-semibold text-white">Sync Organization</Dialog.Title>
                        <Dialog.Description className="mt-2 text-sm text-gray-300">
                            GitHub Organization 이름을 입력하세요. 비워두면 환경변수 `GITHUB_ORG`를 사용합니다.
                        </Dialog.Description>
                        <input
                            value={syncOrg}
                            onChange={(event) => setSyncOrg(event.target.value)}
                            placeholder="e.g. my-company-org"
                            className="mt-4 w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                        />
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setSyncOpen(false)}
                                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={runSync}
                                disabled={syncLoading}
                                className="rounded-md bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
                            >
                                {syncLoading ? '동기화 중...' : 'Sync 실행'}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#101217] p-5 shadow-2xl focus:outline-none">
                        <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-white">
                            <PlusCircle className="h-5 w-5" />
                            Add Service
                        </Dialog.Title>
                        <div className="mt-4 space-y-3">
                            <div>
                                <label className="mb-1 block text-xs text-gray-400">repo_name</label>
                                <input
                                    value={newRepoName}
                                    onChange={(event) => setNewRepoName(event.target.value)}
                                    placeholder="example-service"
                                    className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs text-gray-400">alias (optional)</label>
                                <input
                                    value={newAlias}
                                    onChange={(event) => setNewAlias(event.target.value)}
                                    placeholder="Example Service"
                                    className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs text-gray-400">type</label>
                                <select
                                    value={newType}
                                    onChange={(event) => setNewType(event.target.value)}
                                    className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                                >
                                    {selectableTypeNames.map((typeName) => (
                                        <option key={typeName} value={typeName}>
                                            {typeName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setAddOpen(false)}
                                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={runAddProject}
                                disabled={addLoading}
                                className="rounded-md bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
                            >
                                {addLoading ? '추가 중...' : '추가'}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <ConfirmDialog
                open={Boolean(deleteTarget)}
                title="서비스 삭제"
                description={
                    deleteTarget
                        ? `"${deleteTarget.alias?.trim() || deleteTarget.repo_name}" 서비스를 삭제 상태로 전환할까요?`
                        : undefined
                }
                destructive
                loading={deleteLoading}
                confirmText="삭제"
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
                onConfirm={runDeleteProject}
            />
        </>
    );
}
