// ============================================================
// API Route: Story Agent Export - Save Markdown (fallback)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { exportToZipBuffer } from '@/lib/story-agent-word-export';

export async function POST(request: NextRequest) {
  try {
    const doc = await request.text();
    const trimmed = doc?.trim() ?? '';
    if (!trimmed || !trimmed.startsWith('#')) {
      return NextResponse.json(
        { error: 'Invalid markdown' },
        { status: 400 },
      );
    }

    const { zipBuffer, title } = await exportToZipBuffer(trimmed);
    const filename = `${title}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error('[story-agent/export/save-markdown]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Save failed',
      },
      { status: 500 },
    );
  }
}
