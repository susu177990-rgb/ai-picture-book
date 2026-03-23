// ============================================================
// API Route: Parse DOCX to plain text
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请上传 .docx 文件' }, { status: 400 });
    }

    if (!file.name.endsWith('.docx')) {
      return NextResponse.json(
        { error: '仅支持 .docx 格式文件' },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();

    // 使用 mammoth 提取纯文本
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });

    return NextResponse.json({
      text: result.value,
      messages: result.messages,
    });
  } catch (err) {
    console.error('DOCX parsing error:', err);
    return NextResponse.json(
      {
        error: `解析文档失败: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
