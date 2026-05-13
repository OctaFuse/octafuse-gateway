import next from 'eslint-config-next';

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
];

export default config;
