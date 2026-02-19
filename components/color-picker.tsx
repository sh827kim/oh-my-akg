'use client';

import { Check } from 'lucide-react';

export const TAG_COLORS = [
    { name: 'Red', value: 'bg-red-500/10 text-red-400 ring-red-400/20' },
    { name: 'Orange', value: 'bg-orange-500/10 text-orange-400 ring-orange-400/20' },
    { name: 'Amber', value: 'bg-amber-500/10 text-amber-400 ring-amber-400/20' },
    { name: 'Yellow', value: 'bg-yellow-500/10 text-yellow-400 ring-yellow-400/20' },
    { name: 'Lime', value: 'bg-lime-500/10 text-lime-400 ring-lime-400/20' },
    { name: 'Green', value: 'bg-green-500/10 text-green-400 ring-green-400/20' },
    { name: 'Emerald', value: 'bg-emerald-500/10 text-emerald-400 ring-emerald-400/20' },
    { name: 'Teal', value: 'bg-teal-500/10 text-teal-400 ring-teal-400/20' },
    { name: 'Cyan', value: 'bg-cyan-500/10 text-cyan-400 ring-cyan-400/20' },
    { name: 'Sky', value: 'bg-sky-500/10 text-sky-400 ring-sky-400/20' },
    { name: 'Blue', value: 'bg-blue-500/10 text-blue-400 ring-blue-400/20' },
    { name: 'Indigo', value: 'bg-indigo-500/10 text-indigo-400 ring-indigo-400/20' },
    { name: 'Violet', value: 'bg-violet-500/10 text-violet-400 ring-violet-400/20' },
    { name: 'Purple', value: 'bg-purple-500/10 text-purple-400 ring-purple-400/20' },
    { name: 'Fuchsia', value: 'bg-fuchsia-500/10 text-fuchsia-400 ring-fuchsia-400/20' },
    { name: 'Pink', value: 'bg-pink-500/10 text-pink-400 ring-pink-400/20' },
    { name: 'Rose', value: 'bg-rose-500/10 text-rose-400 ring-rose-400/20' },
];

interface ColorPickerProps {
    selectedColor?: string;
    onSelect: (colorClass: string) => void;
}

export function ColorPicker({ selectedColor, onSelect }: ColorPickerProps) {
    return (
        <div className="grid grid-cols-6 gap-2 p-2">
            {TAG_COLORS.map((color) => (
                <button
                    key={color.name}
                    onClick={() => onSelect(color.value)}
                    className={`h-6 w-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${color.value.split(' ')[0].replace('/10', '')}`}
                    title={color.name}
                >
                    {selectedColor === color.value && <Check className="h-3 w-3 text-white" />}
                </button>
            ))}
        </div>
    );
}
