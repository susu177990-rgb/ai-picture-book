export interface ClassifiedPipelineError {
  summary: string;
  suggestion: string;
}

function normalizeErrorText(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  return String(error ?? '').toLowerCase();
}

export function classifyPipelineError(error: unknown): ClassifiedPipelineError {
  const text = normalizeErrorText(error);

  if (
    text.includes('请先在设置页面配置') ||
    text.includes('请先在设置中配置') ||
    text.includes('missing api key') ||
    text.includes('missing base url') ||
    text.includes('缺少风格模块')
  ) {
    return {
      summary: '配置缺失',
      suggestion: '请先在设置页补全必要配置后再重试',
    };
  }

  if (text.includes('401') || text.includes('403') || text.includes('unauthorized') || text.includes('forbidden')) {
    return {
      summary: 'API 鉴权失败',
      suggestion: '请检查 API Key 是否正确且仍然有效',
    };
  }

  if (
    text.includes('404') ||
    text.includes('model') ||
    text.includes('not found') ||
    text.includes('base url') ||
    text.includes('endpoint') ||
    text.includes('invalid url')
  ) {
    return {
      summary: '接口地址或模型错误',
      suggestion: '请检查 Base URL 和模型名是否与当前接口匹配',
    };
  }

  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('aborted') ||
    text.includes('network request failed')
  ) {
    return {
      summary: '请求超时',
      suggestion: '网络恢复后重试，必要时降低并发或更换接口',
    };
  }

  if (
    text.includes('未返回图像') ||
    text.includes('未返回数据') ||
    text.includes('no image') ||
    text.includes('no images') ||
    text.includes('empty image')
  ) {
    return {
      summary: '生图未返回图片',
      suggestion: '请直接重试一次，若持续失败再检查模型能力',
    };
  }

  if (
    text.includes('解析失败') ||
    text.includes('文档解析失败') ||
    text.includes('parse-docx') ||
    text.includes('docx')
  ) {
    return {
      summary: '文档解析失败',
      suggestion: '请检查 .docx 内容格式后重新上传',
    };
  }

  return {
    summary: '未知错误',
    suggestion: '请重试；若重复出现，再检查接口配置与网络状态',
  };
}

export function formatSaveTime(date = new Date()): string {
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
