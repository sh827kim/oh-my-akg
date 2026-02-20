import type { Metadata } from "next";
import { Suspense } from "react";
import { Sidebar } from '@/components/sidebar';
import { AgentChat } from '@/components/agent-chat';
import { CommandPalette } from '@/components/command-palette';
import "./globals.css";

export const metadata: Metadata = {
  title: "Archi.Navi",
  description: "Architecture Intelligence Platform for GitHub Organizations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body
        className="antialiased flex h-full bg-background text-foreground overflow-hidden"
      >
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <Suspense fallback={<aside className="w-64 border-r border-white/10 bg-black/40 h-full" />}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="absolute inset-0 pointer-events-none bg-[url('/grid.svg')] opacity-[0.02]" />
          {children}
        </main>
        <AgentChat />
      </body>
    </html>
  );
}
