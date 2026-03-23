// ============================================================
// API Route: Story Agent Conversation by ID (GET, PATCH, DELETE)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  deleteSession,
  patchSession,
} from '@/lib/story-agent-sessions';
import type { StoryAgentMetadata } from '@/lib/story-agent-types';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }
    return NextResponse.json({
      sessionId: id,
      title: session.title,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      stage: session.metadata.stage,
      status: session.metadata.status,
      metadata: session.metadata,
    });
  } catch (err) {
    console.error('[story-agent/conversations/:id] get', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Get failed' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }
    const body = await request.json();
    const { title, metadata } = body as {
      title?: string;
      metadata?: Partial<StoryAgentMetadata>;
    };
    patchSession(id, {
      title: title != null ? String(title) : undefined,
      metadata,
    });
    const updated = getSession(id)!;
    return NextResponse.json({
      ok: true,
      title: updated.title,
      stage: updated.metadata.stage,
      status: updated.metadata.status,
      metadata: updated.metadata,
    });
  } catch (err) {
    console.error('[story-agent/conversations/:id] patch', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Patch failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }
    deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[story-agent/conversations/:id] delete', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    );
  }
}
