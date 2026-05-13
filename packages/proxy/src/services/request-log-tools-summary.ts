/**
 * 将各协议请求体中的 `tools` 转为运维日志用的名称列表，避免把完整 schema 写入 `api_key_request_logs`。
 */

export type ToolsSummaryForLog = {
  _tool_names: string[];
  _tools_count: number;
};

/** OpenAI Chat Completions：`tools[]` 每项通常为 `{ type: "function", function: { name, ... } }`。 */
export function summarizeOpenAiToolsForLog(tools: unknown): ToolsSummaryForLog {
  if (!Array.isArray(tools)) {
    return { _tool_names: [], _tools_count: 0 };
  }
  const names: string[] = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') {
      continue;
    }
    const fn = (t as { function?: unknown }).function;
    if (fn && typeof fn === 'object' && typeof (fn as { name?: unknown }).name === 'string') {
      names.push((fn as { name: string }).name);
      continue;
    }
    if (typeof (t as { name?: unknown }).name === 'string') {
      names.push((t as { name: string }).name);
    }
  }
  return { _tool_names: names, _tools_count: names.length };
}

/** Anthropic Messages：`tools[]` 每项含 `name`（及 description、input_schema 等）。 */
export function summarizeAnthropicToolsForLog(tools: unknown): ToolsSummaryForLog {
  if (!Array.isArray(tools)) {
    return { _tool_names: [], _tools_count: 0 };
  }
  const names: string[] = [];
  for (const t of tools) {
    if (t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string') {
      names.push((t as { name: string }).name);
    }
  }
  return { _tool_names: names, _tools_count: names.length };
}

/** Gemini：`tools` 为 `{ functionDeclarations: { name, ... }[] }[]`。 */
export function summarizeGeminiToolsForLog(tools: unknown): ToolsSummaryForLog {
  if (!Array.isArray(tools)) {
    return { _tool_names: [], _tools_count: 0 };
  }
  const names: string[] = [];
  for (const block of tools) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const fds = (block as { functionDeclarations?: unknown }).functionDeclarations;
    if (!Array.isArray(fds)) {
      continue;
    }
    for (const fd of fds) {
      if (fd && typeof fd === 'object' && typeof (fd as { name?: unknown }).name === 'string') {
        names.push((fd as { name: string }).name);
      }
    }
  }
  return { _tool_names: names, _tools_count: names.length };
}
