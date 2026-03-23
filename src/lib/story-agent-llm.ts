// ============================================================
// Story Agent LLM - Reuse main project's API for chat
// ============================================================

import { callChatCompletions } from '@/lib/api-client';
import type { ChatMessage } from '@/types';

export interface StoryAgentApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Call LLM for Story Agent (chat or export).
 * Uses main project's OpenAI-compatible API.
 */
export async function storyAgentChat(
  messages: ChatMessage[],
  api: StoryAgentApiConfig,
  maxTokens = 16384,
): Promise<string> {
  const response = await callChatCompletions(
    messages,
    {
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      maxTokens,
    },
  );
  return response.text?.trim() ?? '';
}
