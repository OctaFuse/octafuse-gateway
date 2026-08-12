declare module '*.open-next/worker.js' {
	const worker: {
		fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response>;
	};
	export default worker;
}
