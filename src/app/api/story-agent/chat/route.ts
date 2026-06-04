// ============================================================
// API Route: Story Agent Chat
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  createSession,
  appendMessage,
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

    const trimmedMessage = message.trim();
    const existingSession = inputSessionId ? getSession(inputSessionId) : undefined;
    const messagesForApi = [
      { role: 'system' as const, content: loadSystemPrompt() },
      ...(existingSession?.messages ?? []).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      { role: 'user' as const, content: trimmedMessage },
    ];

    const reply = await storyAgentChat(messagesForApi, api);

    const sid = inputSessionId ?? createSession();
    appendMessage(sid, { role: 'user', content: trimmedMessage }, true);
    appendMessage(sid, { role: 'assistant', content: reply });

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
