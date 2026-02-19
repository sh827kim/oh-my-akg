'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Network, Layers, Tag as TagIcon, Box, Link2 } from 'lucide-react';
import { TagManager } from '@/components/tag-manager';

interface Project {
    id: string;
    repo_name: string;
    alias: string | null;
    description: string | null;
    type: string;
    visibility: string;
    status: string;
    updated_at: string;
    inbound_count: number;
    outbound_count: number;
}

interface Tag {
    id: string;
    name: string;
    color: string;
}

interface DependencyItem {
    project_id: string;
    label: string;
    type: string;
}

interface DependenciesResponse {
    inbound: DependencyItem[];
    outbound: DependencyItem[];
}

interface ProjectDetailModalProps {
    project: Project | null;
    isOpen: boolean;
    onClose: () => void;
    tags: Tag[];
}

function getTypeClass(type: string) {
    if (type === 'frontend') return 'bg-blue-500/10 text-blue-400';
    if (type === 'backend') return 'bg-green-500/10 text-green-400';
    if (type === 'middleware') return 'bg-amber-500/10 text-amber-400';
    if (type === 'database') return 'bg-rose-500/10 text-rose-400';
    return 'bg-gray-500/10 text-gray-400';
}

export function ProjectDetailModal({ project, isOpen, onClose, tags }: ProjectDetailModalProps) {
    const [dependencies, setDependencies] = useState<DependenciesResponse>({ inbound: [], outbound: [] });
    const [loadingDeps, setLoadingDeps] = useState(false);
    const [depsError, setDepsError] = useState<string | null>(null);

    useEffect(() => {
        if (!project || !isOpen) return;

        let cancelled = false;
        setLoadingDeps(true);
        setDepsError(null);

        fetch(`/api/projects/${encodeURIComponent(project.id)}/dependencies`)
            .then(async (res) => {
                const json = (await res.json()) as DependenciesResponse | { error?: string };
                if (!res.ok) {
                    throw new Error('error' in json ? json.error : 'Failed to load dependencies');
                }
                if (!cancelled) {
                    setDependencies(json as DependenciesResponse);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setDependencies({ inbound: [], outbound: [] });
                    setDepsError(error instanceof Error ? error.message : 'Failed to load dependencies');
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingDeps(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, project]);

    if (!project) return null;

    const hasLoadedDeps = !loadingDeps && !depsError;
    const inboundCount = hasLoadedDeps ? dependencies.inbound.length : project.inbound_count;
    const outboundCount = hasLoadedDeps ? dependencies.outbound.length : project.outbound_count;

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 animate-in fade-in bg-black/60 backdrop-blur-sm duration-200" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[820px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0A] shadow-2xl animate-in zoom-in-95 duration-200 focus:outline-none">
                    <div className="flex items-start justify-between border-b border-white/5 bg-white/[0.02] p-6">
                        <div className="flex items-center gap-4">
                            <div className={`flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 ${getTypeClass(project.type)}`}>
                                <Box className="h-6 w-6" />
                            </div>
                            <div>
                                <Dialog.Title className="text-xl font-bold text-white">
                                    {project.alias?.trim() ? project.alias : project.repo_name}
                                </Dialog.Title>
                                <div className="mt-1 flex items-center gap-2">
                                    <span className="text-xs text-gray-500">{project.repo_name}</span>
                                    <span className="text-xs text-gray-500">•</span>
                                    <span className="text-xs text-gray-500">
                                        Updated {new Date(project.updated_at).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <Tabs.Root defaultValue="overview" className="flex flex-1 flex-col overflow-hidden">
                        <div className="border-b border-white/5 px-6">
                            <Tabs.List className="flex gap-6">
                                <Tabs.Trigger
                                    value="overview"
                                    className="py-4 text-sm font-medium text-gray-400 outline-none transition-colors data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white"
                                >
                                    Overview
                                </Tabs.Trigger>
                                <Tabs.Trigger
                                    value="dependencies"
                                    className="py-4 text-sm font-medium text-gray-400 outline-none transition-colors data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white"
                                >
                                    Dependencies
                                </Tabs.Trigger>
                                <Tabs.Trigger
                                    value="metadata"
                                    className="py-4 text-sm font-medium text-gray-400 outline-none transition-colors data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white"
                                >
                                    Metadata
                                </Tabs.Trigger>
                            </Tabs.List>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-black/20 p-6">
                            <Tabs.Content value="overview" className="space-y-6 outline-none">
                                <div className="space-y-2">
                                    <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">Description</h3>
                                    <p className="leading-relaxed text-gray-300">
                                        {project.description || 'No description provided.'}
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-gray-400">
                                        <TagIcon className="h-3 w-3" /> Tags
                                    </h3>
                                    <div className="py-2">
                                        <TagManager
                                            tags={tags}
                                            isEditMode={false}
                                            onAddTag={(_tagId) => { }}
                                            onRemoveTag={(_tagId) => { }}
                                        />
                                        {tags.length === 0 && <span className="text-sm italic text-gray-500">No tags assigned</span>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="rounded-lg border border-white/5 bg-white/5 p-4">
                                        <div className="mb-2 flex items-center gap-2">
                                            <Network className="h-4 w-4 text-primary" />
                                            <span className="text-sm font-medium text-white">Inbound</span>
                                        </div>
                                        <p className="text-2xl font-bold text-white">{inboundCount}</p>
                                        <p className="text-xs text-gray-400">Modules depending on this project</p>
                                    </div>
                                    <div className="rounded-lg border border-white/5 bg-white/5 p-4">
                                        <div className="mb-2 flex items-center gap-2">
                                            <Layers className="h-4 w-4 text-secondary" />
                                            <span className="text-sm font-medium text-white">Outbound</span>
                                        </div>
                                        <p className="text-2xl font-bold text-white">{outboundCount}</p>
                                        <p className="text-xs text-gray-400">Dependencies this project uses</p>
                                    </div>
                                </div>
                            </Tabs.Content>

                            <Tabs.Content value="dependencies" className="space-y-4 outline-none">
                                {loadingDeps && (
                                    <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                                        Loading dependency list...
                                    </div>
                                )}
                                {depsError && (
                                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                                        {depsError}
                                    </div>
                                )}

                                {!loadingDeps && !depsError && (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                                            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                                <Network className="h-4 w-4 text-primary" />
                                                Inbound ({dependencies.inbound.length})
                                            </h3>
                                            {dependencies.inbound.length === 0 ? (
                                                <p className="text-sm text-gray-500">No inbound dependencies.</p>
                                            ) : (
                                                <ul className="space-y-2">
                                                    {dependencies.inbound.map((item) => (
                                                        <li
                                                            key={`in-${item.project_id}-${item.type}`}
                                                            className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-3 py-2"
                                                        >
                                                            <span className="truncate text-sm text-gray-200">{item.label}</span>
                                                            <span className="ml-2 rounded bg-white/10 px-2 py-0.5 text-xs text-gray-400">
                                                                {item.type}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                                            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                                <Link2 className="h-4 w-4 text-secondary" />
                                                Outbound ({dependencies.outbound.length})
                                            </h3>
                                            {dependencies.outbound.length === 0 ? (
                                                <p className="text-sm text-gray-500">No outbound dependencies.</p>
                                            ) : (
                                                <ul className="space-y-2">
                                                    {dependencies.outbound.map((item) => (
                                                        <li
                                                            key={`out-${item.project_id}-${item.type}`}
                                                            className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-3 py-2"
                                                        >
                                                            <span className="truncate text-sm text-gray-200">{item.label}</span>
                                                            <span className="ml-2 rounded bg-white/10 px-2 py-0.5 text-xs text-gray-400">
                                                                {item.type}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </Tabs.Content>

                            <Tabs.Content value="metadata" className="space-y-6 outline-none">
                                <div className="grid grid-cols-[140px_1fr] gap-4 text-sm">
                                    <span className="text-gray-500">Repository ID</span>
                                    <span className="font-mono text-gray-300">{project.id}</span>

                                    <span className="text-gray-500">Type</span>
                                    <span className="text-gray-300">{project.type}</span>

                                    <span className="text-gray-500">Visibility</span>
                                    <span className="text-gray-300">{project.visibility}</span>

                                    <span className="text-gray-500">Status</span>
                                    <span className="text-gray-300">{project.status}</span>

                                    <span className="text-gray-500">Last Updated</span>
                                    <span className="text-gray-300">{new Date(project.updated_at).toLocaleString()}</span>
                                </div>
                            </Tabs.Content>
                        </div>
                    </Tabs.Root>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
