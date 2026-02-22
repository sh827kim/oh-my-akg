/**
 * 루트 페이지 — /architecture로 리다이렉트
 */
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/architecture');
}
