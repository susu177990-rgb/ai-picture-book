#!/usr/bin/env node
/**
 * API 连接测试脚本
 * 用法: node scripts/test-api-connection.mjs
 * 或: API_BASE_URL=xxx API_KEY=xxx LLM_MODEL=xxx node scripts/test-api-connection.mjs
 */

const BASE_URL = process.env.API_BASE_URL || 'https://api.laozhang.ai';
const API_KEY = process.env.API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3-pro-image-preview';

async function testLLMConnection() {
  const cleanBaseUrl = BASE_URL.replace(/\/+$/, '');
  let url = cleanBaseUrl;
  if (!url.includes('/v1') && !url.includes('generativelanguage')) {
    url = url + '/v1';
  }
  url = url + '/chat/completions';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY ? `Bearer ${API_KEY}` : '',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: 'Say "OK" in one word.' }],
      max_tokens: 10,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM API 错误 (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  const reply = data?.choices?.[0]?.message?.content || '(无内容)';
  return { success: true, message: `LLM 连接成功，模型回复: ${reply}` };
}

async function testImageApiReachability() {
  const cleanBaseUrl = BASE_URL.replace(/\/+$/, '');
  const url = `${cleanBaseUrl}/v1beta/models/${IMAGE_MODEL}:generateContent?key=${API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY ? `Bearer ${API_KEY}` : '',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Generate a simple red circle.' }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { imageSize: '1K', aspectRatio: '1:1' },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return { success: false, message: `生图 API 错误 (${res.status}): ${text.slice(0, 300)}` };
  }
  const data = JSON.parse(text);
  const hasImage = !!data?.candidates?.[0]?.content?.parts?.some((p) => p.inlineData || p.inline_data);
  return { success: true, message: hasImage ? '生图 API 连接成功，已返回图片' : '生图 API 响应异常（无图片）' };
}

async function main() {
  console.log('========================================');
  console.log('  AI 儿童绘本 - API 连接检查');
  console.log('========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`LLM Model: ${LLM_MODEL}`);
  console.log(`Image Model: ${IMAGE_MODEL}`);
  console.log(`API Key: ${API_KEY ? '***' + API_KEY.slice(-4) : '(未设置)'}`);
  console.log('');

  if (!API_KEY?.trim()) {
    console.log('❌ 未设置 API_KEY，请通过环境变量传入:');
    console.log('   API_BASE_URL=xxx API_KEY=xxx LLM_MODEL=xxx node scripts/test-api-connection.mjs');
    process.exit(1);
  }

  let hasError = false;

  // 1. 测试 LLM 连接
  console.log('1. 测试 LLM (Chat Completions) 连接...');
  try {
    const llm = await testLLMConnection();
    console.log('   ✅', llm.message);
  } catch (err) {
    console.log('   ❌', err.message);
    hasError = true;
  }

  // 2. 测试生图 API
  console.log('\n2. 测试生图 (Gemini generateContent) 连接...');
  try {
    const img = await testImageApiReachability();
    console.log(img.success ? '   ✅' : '   ❌', img.message);
    if (!img.success) hasError = true;
  } catch (err) {
    console.log('   ❌', err.message);
    hasError = true;
  }

  console.log('\n========================================');
  console.log(hasError ? '❌ 部分 API 连接失败' : '✅ 所有 API 连接正常');
  console.log('========================================');
  process.exit(hasError ? 1 : 0);
}

main().catch((err) => {
  console.error('运行出错:', err);
  process.exit(1);
});
