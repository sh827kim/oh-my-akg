/**
 * AI 질의 페이지 — 플로팅 채팅으로 대체됨
 * 기존 URL 호환을 위해 /architecture로 리디렉트
 */
import { redirect } from 'next/navigation';

export default function ChatPage() {
  redirect('/architecture');
}
