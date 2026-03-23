import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

type StoryAgentRuleKey =
  | 'main_prompt'
  | 'role'
  | 'rule'
  | 'skill'
  | 'flowchart'
  | 'character_reference'
  | 'story_bible_template'
  | 'spread_pacing_template'
  | 'story_page_script_template';

const FILE_MAP: Record<StoryAgentRuleKey, string> = {
  main_prompt: 'data/story-agent-prompts/core_prompts/main_prompt.md',
  role: 'data/story-agent-prompts/core_prompts/role.md',
  rule: 'data/story-agent-prompts/core_prompts/rule.md',
  skill: 'data/story-agent-prompts/core_prompts/skill.md',
  flowchart: 'data/story-agent-prompts/core_prompts/flowchart.md',
  character_reference: 'data/story-agent-prompts/context_assets/character_reference.md',
  story_bible_template: 'data/story-agent-prompts/templates/Story Bible & Treatment Template.md',
  spread_pacing_template: 'data/story-agent-prompts/templates/Spread Pacing Template.md',
  story_page_script_template: 'data/story-agent-prompts/templates/Story Page Script & Template.md',
};

function isValidKey(value: unknown): value is StoryAgentRuleKey {
  return typeof value === 'string' && value in FILE_MAP;
}

export async function GET() {
  try {
    const projectRoot = process.cwd();
    const entries = await Promise.all(
      (Object.keys(FILE_MAP) as StoryAgentRuleKey[]).map(async (key) => {
        const filePath = path.join(projectRoot, FILE_MAP[key]);
        const content = await fs.readFile(filePath, 'utf-8');
        return [key, content] as const;
      }),
    );

    return NextResponse.json({
      prompts: Object.fromEntries(entries) as Record<StoryAgentRuleKey, string>,
    });
  } catch (err) {
    console.error('读取纪言规则文件失败:', err);
    return NextResponse.json({ error: '读取失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      key?: unknown;
      content?: unknown;
    };

    if (!isValidKey(body.key) || typeof body.content !== 'string') {
      return NextResponse.json({ error: '无效的规则文件或内容' }, { status: 400 });
    }

    const projectRoot = process.cwd();
    const filePath = path.join(projectRoot, FILE_MAP[body.key]);
    await fs.writeFile(filePath, body.content, 'utf-8');

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('保存纪言规则文件失败:', err);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}
