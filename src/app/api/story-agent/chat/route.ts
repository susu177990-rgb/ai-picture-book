// ============================================================
// API Route: Story Agent Chat
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  createSession,
  appendMessage,
  saveSessionsNow,
} from '@/lib/story-agent-sessions';
import { loadSystemPrompt } from '@/lib/story-agent-prompt-loader';
import { storyAgentChat } from '@/lib/story-agent-llm';

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId: inputSessionId, message, api } = body as {
      sessionId?: string;
      message?: string;
      api?: ApiConfig;
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      );
    }

    if (!api?.baseUrl || !api?.model) {
      return NextResponse.json(
        { error: '请先在设置中配置 API（Base URL、API Key、LLM Model）' },
        { status: 400 },
      );
    }

    let sessionId = inputSessionId;
    let session = sessionId ? getSession(sessionId) : undefined;

    if (!session) {
      sessionId = createSession();
      session = getSession(sessionId)!;
    }

    const sid = sessionId as string;
    appendMessage(sid, { role: 'user', content: message.trim() }, true);
    saveSessionsNow();

    const updatedSession = getSession(sid)!;
    const messagesForApi = [
      { role: 'system' as const, content: loadSystemPrompt() },
      ...updatedSession.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];

    const reply = await storyAgentChat(messagesForApi, api);

    appendMessage(sid, { role: 'assistant', content: reply });
    saveSessionsNow();

    const finalSession = getSession(sid)!;
    return NextResponse.json({
      sessionId: sid,
      title: finalSession.title,
      stage: finalSession.metadata.stage,
      status: finalSession.metadata.status,
      metadata: finalSession.metadata,
      reply,
      messages: finalSession.messages,
    });
  } catch (err) {
    console.error('[story-agent/chat]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Chat failed',
      },
      { status: 500 },
    );
  }
}
