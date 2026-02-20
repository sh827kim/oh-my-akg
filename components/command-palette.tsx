'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Search, Monitor, Server, Database, Boxes } from 'lucide-react';

interface Project {
    id: string;
    repo_name: string;
    type: string;
}

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const router = useRouter();

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener('keydown', down);
        return () => document.removeEventListener('keydown', down);
    }, []);

    useEffect(() => {
        if (open) {
            fetch('/api/projects')
                .then((res) => res.json())
                .then((data) => setProjects(data))
                .catch((err) => console.error('Failed to load projects', err));
        }
    }, [open]);


    if (!open) return null;

    return (
        <>
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <Command.Dialog
                open={open}
                onOpenChange={setOpen}
                label="Global Search"
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#0A0A0A] shadow-2xl overflow-hidden"
            >
                <div className="flex items-center border-b border-white/10 px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-white" />
                    <Command.Input
                        placeholder="Search projects..."
                        className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-500 text-white"
                    />
                </div>

                <Command.List className="max-h-[300px] overflow-y-auto p-2 scrollbar-hide">
                    <Command.Empty className="py-6 text-center text-sm text-gray-500">
                        No results found.
                    </Command.Empty>

                    <Command.Group heading="Projects" className="text-xs font-medium text-gray-500 px-2 py-1.5">
                        {projects.map((project) => (
                            <Command.Item
                                key={project.id}
                                onSelect={() => {
                                    setOpen(false);
                                    // Update URL to filter by this project name
                                    router.push(`/?q=${project.repo_name}`);
                                }}
                                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-300 aria-selected:bg-primary/20 aria-selected:text-white cursor-pointer"
                            >
                                <div className={`flex h-6 w-6 items-center justify-center rounded border border-white/10 ${project.type === 'frontend' ? 'bg-blue-500/10 text-blue-400' :
                                        project.type === 'backend' ? 'bg-green-500/10 text-green-400' :
                                            project.type === 'middleware' ? 'bg-amber-500/10 text-amber-400' :
                                                'bg-red-500/10 text-red-400'
                                    }`}>
                                    {project.type === 'frontend' ? <Monitor className="h-3 w-3" /> :
                                        project.type === 'backend' ? <Server className="h-3 w-3" /> :
                                            project.type === 'database' ? <Database className="h-3 w-3" /> :
                                                <Boxes className="h-3 w-3" />}
                                </div>
                                <span>{project.repo_name}</span>
                                <span className="ml-auto text-xs text-gray-500">{project.type}</span>
                            </Command.Item>
                        ))}
                    </Command.Group>
                </Command.List>
            </Command.Dialog>
        </>
    );
}
