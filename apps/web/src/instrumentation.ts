/**
 * Next.js Instrumentation — 런타임 분기
 * Node.js 전용 로직은 instrumentation.node.ts에 위임
 */
export async function register() {
  // Node.js 런타임에서만 실행 (Edge 제외)
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { register: nodeRegister } = await import('./instrumentation.node');
    await nodeRegister();
  }
}
