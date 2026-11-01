import next from 'eslint-config-next';

// eslint-config-next stays at the existing 16.2.3 rule baseline in package.json;
// adopting React Compiler rules is a separate migration from runtime security fixes.

/** @type {import('eslint').Linter.Config[]} */
const config = [
	...next,
	{
		ignores: [
			'.open-next/**',
			'.wrangler/**',
			'cloudflare-env.d.ts',
			'scripts/**',
		],
	},
	{
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@octafuse/proxy', '@octafuse/proxy/*', '@octafuse/proxy-services', '@octafuse/proxy-services/*'],
							message:
								'Admin must not import @octafuse/proxy. Use @octafuse/tool-engines for Tool engine clients.',
						},
						{
							group: ['**/packages/proxy/**', '../proxy/**', '../../proxy/**'],
							message:
								'Admin must not reach into packages/proxy. Shared Tool engines live in @octafuse/tool-engines.',
						},
					],
				},
			],
		},
	},
];

export default config;
