import { normalizeProxyBaseUrl } from '@/lib/proxy-base-url';
export const normalizeToolProxyUrl = normalizeProxyBaseUrl;
/** Public REST tool contracts and copyable integration samples. No provider credentials belong here. */
export const TOOL_PROXY_PLACEHOLDER = 'https://<YOUR_PROXY_URL>';

const query = { type: 'string', minLength: 2 };
const domains = { type: 'array', items: { type: 'string' } };
export const TOOL_API_DEFINITIONS = {
	'web-search': {
		name: 'web_search',
		required: ['query'],
		properties: {
			query,
			count: { type: 'integer', minimum: 1, maximum: 10, default: 8 },
			allowed_domains: domains,
			blocked_domains: domains,
		},
		request: { query: 'Octafuse Gateway', count: 8 },
		response: {
			'data.results': 'array',
			'data.results[].title': 'string',
			'data.results[].url': 'string',
			'data.results[].snippet': 'string?',
			'data.results[].summary': 'string?',
			'data.cost': 'number',
		},
	},
	'web-fetch': {
		name: 'web_fetch',
		required: ['url'],
		properties: { url: { type: 'string', format: 'uri', pattern: '^https?://' } },
		request: { url: 'https://example.com/page' },
		response: {
			'data.url': 'string',
			'data.title': 'string?',
			'data.content': 'string',
			'data.cost': 'number',
		},
	},
	'web-deep-search': {
		name: 'web_deep_search',
		required: ['query'],
		properties: { query, count: { type: 'integer', minimum: 1, maximum: 10, default: 5 } },
		request: { query: 'Octafuse Gateway', count: 5 },
		response: {
			'data.results': 'array',
			'data.results[].title': 'string',
			'data.results[].url': 'string',
			'data.results[].snippet': 'string?',
			'data.results[].content': 'string?',
			'data.cost': 'number',
		},
	},
	'ai-detection': {
		name: 'ai_detection',
		required: ['text'],
		properties: { text: { type: 'string', minLength: 1 } },
		request: { text: 'Sample text to analyze.' },
		response: {
			'data.overall_score': 'number',
			'data.total_chars': 'integer',
			'data.segments': 'array',
			'data.segments[].score': 'number',
			'data.billing_units': 'integer',
			'data.cost': 'number',
		},
	},
} as const;
export type RestToolId = keyof typeof TOOL_API_DEFINITIONS;
export function isRestToolId(id: string): id is RestToolId {
	return Object.hasOwn(TOOL_API_DEFINITIONS, id);
}

export function toolApiUrl(id: RestToolId, baseUrl: string): string {
	return `${normalizeToolProxyUrl(baseUrl) ?? TOOL_PROXY_PLACEHOLDER}/v1/tools/${id}`;
}
const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export function buildToolCurl(id: RestToolId, baseUrl: string): string {
	return [
		`curl --request POST ${shellQuote(toolApiUrl(id, baseUrl))}`,
		'  --header "Authorization: Bearer $OCTAFUSE_API_KEY"',
		"  --header 'Content-Type: application/json'",
		`  --data ${shellQuote(JSON.stringify(TOOL_API_DEFINITIONS[id].request, null, 2))}`,
	].join(' \\\n');
}

export function buildAgentToolDefinition(id: RestToolId, description: string, fields: Record<string, string>) {
	const tool = TOOL_API_DEFINITIONS[id];
	return {
		name: tool.name,
		description,
		inputSchema: {
			type: 'object',
			properties: Object.fromEntries(
				Object.entries(tool.properties).map(([name, schema]) => [name, { ...schema, description: fields[name] }])
			),
			required: [...tool.required],
			additionalProperties: false,
		},
	};
}

export const AGENT_TOOL_FORMATS = ['generic', 'responses', 'chat', 'anthropic'] as const;
export type AgentToolFormat = (typeof AGENT_TOOL_FORMATS)[number];
export const AGENT_TOOL_DOCS: Partial<Record<AgentToolFormat, string>> = {
	responses: 'https://developers.openai.com/api/docs/guides/function-calling',
	chat: 'https://developers.openai.com/api/docs/guides/function-calling',
	anthropic: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview',
};

/** Keep optional REST arguments optional; do not silently normalize them into strict-mode required fields. */
export function formatAgentToolDefinition(
	definition: ReturnType<typeof buildAgentToolDefinition>,
	format: AgentToolFormat
) {
	const { name, description, inputSchema } = definition;
	switch (format) {
		case 'responses':
			return { type: 'function', name, description, parameters: inputSchema, strict: false };
		case 'chat':
			return { type: 'function', function: { name, description, parameters: inputSchema, strict: false } };
		case 'anthropic':
			return { name, description, input_schema: inputSchema };
		default:
			return definition;
	}
}

/** A bridge for one selected tool, not an SDK-specific model loop or dynamic function dispatcher. */
export function buildAgentToolHandler(id: RestToolId, format: AgentToolFormat): string {
	const name = TOOL_API_DEFINITIONS[id].name;
	const signature = {
		generic: 'name: string; arguments: Record<string, unknown>',
		responses: 'name: string; arguments: string; call_id: string',
		chat: 'id: string; function: { name: string; arguments: string }',
		anthropic: 'name: string; input: Record<string, unknown>; id: string',
	}[format];
	const callName = format === 'chat' ? 'call.function.name' : 'call.name';
	const args = {
		generic: 'call.arguments',
		responses: 'JSON.parse(call.arguments)',
		chat: 'JSON.parse(call.function.arguments)',
		anthropic: 'call.input',
	}[format];
	const result = {
		generic: 'data',
		responses: '{ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(data) }',
		chat: '{ role: "tool", tool_call_id: call.id, content: JSON.stringify(data) }',
		anthropic: '{ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(data) }',
	}[format];
	return `export async function handleToolCall(call: { ${signature} }) {
  if (${callName} !== "${name}") throw new Error("Unknown tool");
  const data = await ${name}(${args});
  return ${result}${format === 'generic' ? '' : ' as const'};
}`;
}

export function buildToolExecutor(id: RestToolId, baseUrl: string): string {
	const base = normalizeToolProxyUrl(baseUrl) ?? TOOL_PROXY_PLACEHOLDER;
	return `export async function ${TOOL_API_DEFINITIONS[id].name}(args: Record<string, unknown>) {
  const baseUrl = process.env.OCTAFUSE_BASE_URL || ${JSON.stringify(base)};
  const apiKey = process.env.OCTAFUSE_API_KEY;
  if (!apiKey) throw new Error("OCTAFUSE_API_KEY");

  const response = await fetch(baseUrl.replace(/\\/+$/, "") + "/v1/tools/${id}", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${apiKey}\`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(\`\${response.status}: \${JSON.stringify(payload)}\`);
  return payload.data;
}`;
}
