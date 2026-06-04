# AI 儿童绘本生成器

全自动 AI 儿童绘本生成软件。上传故事剧本与艺术风格参考图，一键生成高品质儿童绘本插画。

## 功能概述

- **上传素材**：支持 .docx 格式的故事剧本与 jpg/png 风格参考图
- **全局解析**：自动解析画风与视觉质感，提取角色/物品设定
- **角色资产**：生成角色与物品三视图，支持人工审核与重新生成
- **分页成品**：根据剧本分页生成绘本插画，支持打包下载为 ZIP

## 环境要求

- Node.js 18+
- npm 或 pnpm

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 可用脚本

| 命令                   | 说明                     |
| ---------------------- | ------------------------ |
| `npm run dev`          | 启动开发服务器           |
| `npm run build`        | 生产环境构建             |
| `npm run start`        | 启动生产服务器           |
| `npm run lint`         | 运行 ESLint 检查         |
| `npm run lint:fix`     | 自动修复 ESLint 问题     |
| `npm run format`       | 使用 Prettier 格式化代码 |
| `npm run format:check` | 检查代码格式             |

## 设置说明

首次使用前，请在「设置」页面配置：

1. **API 连接**：Base URL、API Key、LLM 模型、生图模型
2. **接口格式**：支持 Gemini 原生、Nano Banana Generations、Nano Banana Draw
3. **提示词模板**：可编辑各阶段提示词，适配不同模型和工作流

配置中的 API 参数保存在浏览器 localStorage。
用户提示词、纪言规则和会话数据保存在项目 `data/` 目录。

## 技术栈

- **框架**：Next.js 16、React 19
- **状态管理**：Zustand
- **文档解析**：mammoth (.docx)
- **压缩**：fflate (ZIP 打包)

## 数据说明

- `data/user-prompts.json`：用户自定义提示词
- `data/story-agent-prompts/`：纪言规则与模板
- `data/story-agent-sessions.json`：纪言对话会话
