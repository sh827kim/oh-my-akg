'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Tag {
    id: string;
    name: string;
    color: string; // hex color
}

interface TagManagerProps {
    tags: Tag[];
    availableTags?: Tag[];
    isEditMode: boolean;
    onAddTag: (tagId: string) => void;
    onRemoveTag: (id: string) => void;
}

function withAlpha(hex: string, alphaHex: string) {
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return `${hex}${alphaHex}`;
    return hex;
}

export function TagManager({
    tags,
    availableTags = [],
    isEditMode,
    onAddTag,
    onRemoveTag,
}: TagManagerProps) {
    const [isAdding, setIsAdding] = useState(false);
    const [selectedTagId, setSelectedTagId] = useState('');

    const assignableTags = useMemo(() => {
        const assigned = new Set(tags.map((tag) => tag.id));
        return availableTags.filter((tag) => !assigned.has(tag.id));
    }, [availableTags, tags]);

    const handleAdd = () => {
        if (!selectedTagId) return;
        onAddTag(selectedTagId);
        setSelectedTagId('');
        setIsAdding(false);
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
                <span
                    key={tag.id}
                    className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-all"
                    style={{
                        color: tag.color,
                        backgroundColor: withAlpha(tag.color, '1A'),
                        borderColor: withAlpha(tag.color, '66'),
                    }}
                >
                    {tag.name}
                    {isEditMode && (
                        <button
                            type="button"
                            onClick={() => onRemoveTag(tag.id)}
                            className="ml-1 rounded-full p-0.5 hover:bg-black/20"
                        >
                            <X className="h-2.5 w-2.5" />
                        </button>
                    )}
                </span>
            ))}

            {isEditMode && !isAdding && assignableTags.length > 0 && (
                <button
                    type="button"
                    onClick={() => setIsAdding(true)}
                    className="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-gray-400 transition-colors hover:bg-white/20 hover:text-white"
                    title="Add Tag"
                >
                    <Plus className="h-3 w-3" />
                </button>
            )}

            {isEditMode && isAdding && (
                <div className="flex items-center gap-2">
                    <select
                        value={selectedTagId}
                        onChange={(event) => setSelectedTagId(event.target.value)}
                        className="h-7 rounded border border-white/20 bg-black/40 px-2 text-xs text-white focus:border-primary focus:outline-none"
                    >
                        <option value="">태그 선택</option>
                        {assignableTags.map((tag) => (
                            <option key={tag.id} value={tag.id}>
                                {tag.name}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={handleAdd}
                        className="h-7 rounded bg-primary/20 px-2 text-xs font-medium text-primary hover:bg-primary/30"
                    >
                        Add
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedTagId('');
                            setIsAdding(false);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-white/10"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    );
}
