// ============================================================
// API Route: Story Agent Conversations (GET list, POST create)
// ============================================================

import { NextResponse } from 'next/server';
import {
  listSessions,
  createSession,
  getSession,
} from '@/lib/story-agent-sessions';

export async function GET() {
  try {
    const list = listSessions();
    return NextResponse.json(list);
  } catch (err) {
    console.error('[story-agent/conversations] list', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'List failed' },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const sessionId = createSession();
    const session = getSession(sessionId);
    return NextResponse.json({
      sessionId,
      title: session?.title ?? '新对话',
      metadata: session?.metadata,
    });
  } catch (err) {
    console.error('[story-agent/conversations] create', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
