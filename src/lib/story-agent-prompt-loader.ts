// ============================================================
// Story Agent Prompt Loader - Load and concatenate prompt files
// ============================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { getAppDataPath } from '@/lib/app-data-dir';

const PROMPT_FILES = [
  'core_prompts/main_prompt.md',
  'core_prompts/role.md',
  'core_prompts/rule.md',
  'core_prompts/skill.md',
  'core_prompts/flowchart.md',
  'context_assets/character_reference.md',
  'templates/Story Bible & Treatment Template.md',
  'templates/Spread Pacing Template.md',
  'templates/Story Page Script & Template.md',
];

const BASE_PATH = getAppDataPath('story-agent-prompts');

/**
 * Load and concatenate all prompt files for the Story Agent
 */
export function loadSystemPrompt(): string {
  const parts: string[] = [];
  for (const file of PROMPT_FILES) {
    try {
      const content = readFileSync(join(BASE_PATH, file), 'utf-8');
      parts.push(`\n\n---\n\n# ${file}\n\n${content}`);
    } catch (err) {
      console.warn(`[story-agent-prompt-loader] Could not load ${file}:`, err);
    }
  }
  return parts.join('\n');
}
