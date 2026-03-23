// ============================================================
// Story Agent Sessions - File-based Session Storage
// ============================================================

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_STORY_AGENT_METADATA,
  deriveStoryAgentStatus,
  type StoryAgentConversationSummary,
  type StoryAgentMetadata,
  normalizeStoryAgentMetadata,
} from '@/lib/story-agent-types';

const DATA_DIR = join(process.cwd(), 'data');
const SESSIONS_FILE = join(DATA_DIR, 'story-agent-sessions.json');

export interface SessionMessage {
  role: string;
  content: string;
}

export interface Session {
  messages: SessionMessage[];
  title: string;
  createdAt: number;
  updatedAt: number;
  metadata: StoryAgentMetadata;
}

const sessions = new Map<string, Session>();

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadSessions() {
  ensureDataDir();
  if (!existsSync(SESSIONS_FILE)) return;
  let shouldPersistMigration = false;
  try {
    const raw = readFileSync(SESSIONS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      for (const s of data) {
        try {
          if (s?.id && Array.isArray(s?.messages)) {
            if (!s.metadata) {
              shouldPersistMigration = true;
            }
            sessions.set(String(s.id), {
              messages: s.messages,
              title: (s.title && String(s.title)) || '新对话',
              createdAt: Number(s.createdAt) || Date.now(),
              updatedAt: Number(s.updatedAt) || Date.now(),
              metadata: normalizeStoryAgentMetadata(s.metadata),
            });
          }
        } catch (e) {
          console.warn('[story-agent-sessions] Skip invalid session:', e);
        }
      }
    }
  } catch (err) {
    console.warn('[story-agent-sessions] Load failed:', err);
  }

  if (shouldPersistMigration) {
    saveSessions();
  }
}

function saveSessions() {
  ensureDataDir();
  try {
    const data: Array<{
      id: string;
      title: string;
      messages: SessionMessage[];
      createdAt: number;
      updatedAt: number;
      metadata: StoryAgentMetadata;
    }> = [];
    for (const [id, s] of sessions) {
      data.push({
        id,
        title: s.title,
        messages: s.messages,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        metadata: s.metadata,
      });
    }
    data.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[story-agent-sessions] Save failed:', err);
  }
}

loadSessions();

export function saveSessionsNow() {
  saveSessions();
}

function getTitleFromMessage(content: string): string {
  if (!content || typeof content !== 'string') return '新对话';
  const trimmed = content.trim().slice(0, 30);
  return trimmed || '新对话';
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function setSession(
  sessionId: string,
  messages: SessionMessage[],
  title?: string,
  createdAt: number = Date.now(),
  metadata?: Partial<StoryAgentMetadata>,
) {
  const existing = sessions.get(sessionId);
  const nextMetadata = normalizeStoryAgentMetadata({
    ...(existing?.metadata ?? DEFAULT_STORY_AGENT_METADATA),
    ...metadata,
  });
  nextMetadata.status = deriveStoryAgentStatus(nextMetadata, nextMetadata.status);
  sessions.set(sessionId, {
    messages: messages || [],
    title: title || existing?.title || '新对话',
    createdAt: existing?.createdAt || createdAt,
    updatedAt: Date.now(),
    metadata: nextMetadata,
  });
  saveSessions();
}

export function appendMessage(
  sessionId: string,
  message: SessionMessage,
  updateTitle = false,
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push(message);
  session.updatedAt = Date.now();
  if (updateTitle && message.role === 'user' && session.messages.length === 1) {
    session.title = getTitleFromMessage(message.content);
  }
  saveSessions();
}

export function setSessionTitle(sessionId: string, title: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.title = title || '新对话';
  session.updatedAt = Date.now();
  saveSessions();
}

export function updateSessionMetadata(
  sessionId: string,
  updates: Partial<StoryAgentMetadata>,
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const nextMetadata = normalizeStoryAgentMetadata({
    ...session.metadata,
    ...updates,
  });
  nextMetadata.status = deriveStoryAgentStatus(nextMetadata, updates.status ?? session.metadata.status);
  session.metadata = nextMetadata;
  session.updatedAt = Date.now();
  saveSessions();
}

export function patchSession(
  sessionId: string,
  updates: {
    title?: string;
    metadata?: Partial<StoryAgentMetadata>;
  },
) {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (updates.title != null) {
    session.title = updates.title || '新对话';
  }
  if (updates.metadata) {
    const nextMetadata = normalizeStoryAgentMetadata({
      ...session.metadata,
      ...updates.metadata,
    });
    nextMetadata.status = deriveStoryAgentStatus(
      nextMetadata,
      updates.metadata.status ?? session.metadata.status,
    );
    session.metadata = nextMetadata;
  }
  session.updatedAt = Date.now();
  saveSessions();
}

export function createSession(): string {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    messages: [],
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: { ...DEFAULT_STORY_AGENT_METADATA },
  });
  saveSessions();
  return sessionId;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
  saveSessions();
}

export function listSessions(): StoryAgentConversationSummary[] {
  const list: StoryAgentConversationSummary[] = [];
  try {
    for (const [id, s] of sessions) {
      if (!id || !s) continue;
      list.push({
        id: String(id),
        title: (s.title && String(s.title)) || '新对话',
        updatedAt: Number(s.updatedAt || s.createdAt || 0) || 0,
        createdAt: Number(s.createdAt || 0) || 0,
        stage: s.metadata.stage,
        status: s.metadata.status,
        metadata: s.metadata,
      });
    }
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.warn('[story-agent-sessions] listSessions error:', err);
  }
  return list;
}
