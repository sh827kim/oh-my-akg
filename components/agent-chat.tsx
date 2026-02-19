'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, X, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assumes you have this

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export function AgentChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [...messages, userMsg] }),
            });

            if (!response.ok) throw new Error('Failed to fetch response');

            const data = await response.json();
            const botMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.content,
                timestamp: new Date(),
            };

            setMessages((prev) => [...prev, botMsg]);
        } catch (error) {
            console.error('Chat error:', error);
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "Sorry, I encountered an error providing a response.",
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* Floating Toggle Button */}
            <button
                onClick={() => setIsOpen(true)}
                className={cn(
                    "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 shadow-lg transition-transform hover:scale-110 active:scale-95",
                    isOpen && "hidden"
                )}
            >
                <MessageCircle className="h-8 w-8 text-white" />
            </button>

            {/* Chat Window */}
            <div
                className={cn(
                    "fixed bottom-6 right-6 z-50 flex h-[600px] w-[400px] flex-col rounded-2xl border border-[#333] bg-[#0a0a0a] shadow-2xl transition-all duration-300 ease-in-out",
                    !isOpen && "translate-y-20 opacity-0 pointer-events-none"
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[#333] bg-[#1a1a1a] px-4 py-3 rounded-t-2xl">
                    <div className="flex items-center space-x-2">
                        <Bot className="h-6 w-6 text-blue-500" />
                        <span className="font-bold text-white">AKG Agent</span>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-2">
                            <Bot className="h-10 w-10 opacity-50" />
                            <p className="text-sm">Ask me about your architecture!</p>
                        </div>
                    )}
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex w-full",
                                msg.role === 'user' ? "justify-end" : "justify-start"
                            )}
                        >
                            <div
                                className={cn(
                                    "max-w-[80%] rounded-lg px-4 py-2 text-sm",
                                    msg.role === 'user'
                                        ? "bg-blue-600 text-white"
                                        : "bg-[#1f1f1f] text-gray-200"
                                )}
                            >
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-[#1f1f1f] rounded-lg px-4 py-2 text-sm text-gray-400 animate-pulse">
                                Thinking...
                            </div>
                        </div>
                    )}
                </div>

                {/* Input */}
                <form onSubmit={handleSubmit} className="border-t border-[#333] p-4 bg-[#1a1a1a] rounded-b-2xl">
                    <div className="flex items-center space-x-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Query your graph..."
                            className="flex-1 bg-[#2a2a2a] text-white rounded-md border border-[#333] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !input.trim()}
                            className="bg-blue-600 p-2 rounded-md text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Send className="h-5 w-5" />
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
}
