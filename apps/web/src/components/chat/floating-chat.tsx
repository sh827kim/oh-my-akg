/**
 * 플로팅 AI 채팅 패널
 * FAB 버튼(우하단) → 클릭 시 슬라이드 업 채팅 창
 * v1 agent-chat.tsx 패턴 + framer-motion 애니메이션
 */
'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useChat } from 'ai/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MessageSquare,
  X,
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { cn, Button, Input } from '@archi-navi/ui';

/** 예시 질문 목록 */
const EXAMPLE_QUESTIONS = [
  'order-service가 의존하는 서비스는?',
  'payment-service 수정 시 영향받는 서비스는?',
  'user-service에서 DB까지 경로는?',
  '주문 도메인에 속하는 서비스 목록은?',
];

export function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // localStorage에 저장된 AI 설정을 헤더로 전달
  const getAiHeaders = () => {
    try {
      const provider = localStorage.getItem('archi-navi:ai-provider');
      const apiKey = localStorage.getItem('archi-navi:ai-api-key');
      const model = localStorage.getItem('archi-navi:ai-model');
      const headers: Record<string, string> = {};
      if (provider) headers['x-ai-provider'] = provider;
      if (apiKey) headers['x-ai-api-key'] = apiKey;
      if (model) headers['x-ai-model'] = model;
      return headers;
    } catch {
      return {};
    }
  };

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
  } = useChat({
    api: '/api/chat',
    headers: getAiHeaders(),
  });

  // 새 메시지 → 스크롤 하단 이동
  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Cmd+J 토글 단축키
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <>
      {/* FAB 버튼 */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            onClick={toggle}
            className={cn(
              'fixed bottom-6 right-6 z-50',
              'flex h-14 w-14 items-center justify-center rounded-full',
              'bg-primary text-primary-foreground shadow-lg',
              'hover:scale-110 active:scale-95 transition-transform',
              'glow-primary',
            )}
            title="AI 채팅 (⌘J)"
          >
            <MessageSquare className="h-6 w-6" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* 채팅 패널 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={cn(
              'fixed bottom-6 right-6 z-50',
              'flex w-[400px] h-[600px] flex-col',
              'rounded-2xl shadow-2xl overflow-hidden',
              'glass-panel',
            )}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between border-b border-white/10 dark:border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">
                  AI 아키텍처 어시스턴트
                </span>
              </div>
              <button
                onClick={toggle}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                /* 빈 상태 — 예시 질문 */
                <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                  <Bot className="h-10 w-10 text-primary/60" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      아키텍처에 대해 질문하세요
                    </p>
                    <p className="text-xs mt-1 text-muted-foreground">
                      의존 관계, 영향 분석, 경로 탐색 등
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 w-full px-2">
                    {EXAMPLE_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => {
                          const event = {
                            target: { value: q },
                          } as React.ChangeEvent<HTMLInputElement>;
                          handleInputChange(event);
                        }}
                        className={cn(
                          'rounded-lg px-3 py-2 text-left text-xs',
                          'glass-card',
                          'hover:text-foreground transition-colors',
                        )}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* 메시지 목록 */
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex gap-2',
                      msg.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    {/* Bot 아이콘 */}
                    {msg.role !== 'user' && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                        <Bot className="h-3.5 w-3.5" />
                      </div>
                    )}

                    {/* 메시지 버블 */}
                    <div
                      className={cn(
                        'max-w-[280px] rounded-xl px-3 py-2 text-sm leading-relaxed',
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/80 text-foreground',
                      )}
                    >
                      {msg.content}
                    </div>

                    {/* User 아이콘 */}
                    {msg.role === 'user' && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <User className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* 로딩 인디케이터 */}
              {isLoading && (
                <div className="flex gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex items-center rounded-xl bg-muted/80 px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}

              {/* 에러 */}
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                  오류: {error.message}
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* 입력 영역 */}
            <div className="border-t border-white/10 dark:border-white/10 p-3">
              <form
                onSubmit={handleSubmit}
                className="flex gap-2"
              >
                <Input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="질문을 입력하세요..."
                  disabled={isLoading}
                  className="flex-1 h-9 text-sm bg-muted/50 border-white/10"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading || !input.trim()}
                  className="h-9 w-9 p-0"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                ⌘J로 토글
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
