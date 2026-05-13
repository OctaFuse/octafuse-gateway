/**
 * OpenNext + Cloudflare 适配配置。默认不启用 R2 增量缓存；需要时取消注释 `incrementalCache` 并参阅官方文档。
 * @see https://opennext.js.org/cloudflare/caching
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
// import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
	// incrementalCache: r2IncrementalCache,
});
