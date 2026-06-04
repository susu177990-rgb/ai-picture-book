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
const IMAGE_PROTOCOL =
  process.env.IMAGE_PROTOCOL ||
  (IMAGE_MODEL === 'nano-banana-2' ? 'nano-banana-generations' : 'gemini-native');

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

function mapAspectRatio(ratio) {
  if (ratio === '19:7') return '21:9';
  return ratio;
}

function extractDrawData(payload) {
  if (payload && typeof payload === 'object') {
    if (payload.data && typeof payload.data === 'object') {
      return payload.data;
    }
    return payload;
  }
  return {};
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function testGeminiImageApiReachability() {
  const cleanBaseUrl = BASE_URL.replace(/\/+$/, '');
  const url = `${cleanBaseUrl}/v1beta/models/${IMAGE_MODEL}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY,
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

async function testNanoBananaGenerationsReachability() {
  const cleanBaseUrl = BASE_URL.replace(/\/+$/, '');
  const url = `${cleanBaseUrl}/v1/images/generations`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY ? `Bearer ${API_KEY}` : '',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: 'Generate a simple red circle on white background.',
      response_format: 'b64_json',
      aspect_ratio: mapAspectRatio('1:1'),
      image_size: '1K',
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return { success: false, message: `生图 API 错误 (${res.status}): ${text.slice(0, 300)}` };
  }
  const data = JSON.parse(text);
  const hasImage = !!data?.data?.some((item) => item?.b64_json || item?.url);
  return { success: true, message: hasImage ? 'generations 接口连接成功，已返回图片' : 'generations 接口响应异常（无图片）' };
}

async function testNanoBananaDrawReachability() {
  const cleanBaseUrl = BASE_URL.replace(/\/+$/, '');
  const submitUrl = `${cleanBaseUrl}/v1/draw/nano-banana`;
  const resultUrl = `${cleanBaseUrl}/v1/draw/result`;

  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY ? `Bearer ${API_KEY}` : '',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: 'Generate a simple red circle on white background.',
      aspectRatio: '1:1',
      imageSize: '1K',
      webHook: '-1',
      shutProgress: true,
    }),
  });

  const submitText = await submitRes.text();
  if (!submitRes.ok) {
    return { success: false, message: `生图 API 错误 (${submitRes.status}): ${submitText.slice(0, 300)}` };
  }

  const submitPayload = JSON.parse(submitText);
  const submitData = extractDrawData(submitPayload);
  const taskId = typeof submitData.id === 'string' ? submitData.id : '';
  if (!taskId) {
    return { success: false, message: 'draw 接口未返回任务 id' };
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const pollRes = await fetch(resultUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: API_KEY ? `Bearer ${API_KEY}` : '',
      },
      body: JSON.stringify({ id: taskId }),
    });

    const pollText = await pollRes.text();
    if (!pollRes.ok) {
      return { success: false, message: `结果查询错误 (${pollRes.status}): ${pollText.slice(0, 300)}` };
    }

    const pollPayload = JSON.parse(pollText);
    if (pollPayload?.code === -22) {
      return { success: false, message: `任务不存在: ${pollPayload?.msg || taskId}` };
    }
    if (typeof pollPayload?.code === 'number' && pollPayload.code !== 0) {
      return { success: false, message: `结果查询失败: ${pollPayload?.msg || '未知错误'}` };
    }

    const pollData = extractDrawData(pollPayload);
    if (pollData.status === 'succeeded') {
      const hasImage = Array.isArray(pollData.results)
        && pollData.results.some((item) => item?.url);
      return {
        success: hasImage,
        message: hasImage ? 'draw 接口连接成功，已返回图片 URL' : 'draw 接口响应成功，但无图片结果',
      };
    }
    if (pollData.status === 'failed') {
      const reason = [pollData.failure_reason, pollData.error].filter(Boolean).join(' / ');
      return { success: false, message: `draw 任务失败: ${reason || '未知错误'}` };
    }

    await wait(2_000);
  }

  return { success: false, message: 'draw 接口结果查询超时' };
}

async function testImageApiReachability() {
  if (IMAGE_PROTOCOL === 'nano-banana-generations') {
    return testNanoBananaGenerationsReachability();
  }
  if (IMAGE_PROTOCOL === 'nano-banana-draw') {
    return testNanoBananaDrawReachability();
  }
  return testGeminiImageApiReachability();
}

async function main() {
  console.log('========================================');
  console.log('  AI 儿童绘本 - API 连接检查');
  console.log('========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`LLM Model: ${LLM_MODEL}`);
  console.log(`Image Protocol: ${IMAGE_PROTOCOL}`);
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
  console.log(`\n2. 测试生图 (${IMAGE_PROTOCOL}) 连接...`);
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
