# 0032：DashScope 语音转换路由按系列拆开

三库脚本：`packages/core/migrations-{d1,postgres,mysql}/0032_split_audio_adapter_families.sql`。Postgres 脚本会设置 `search_path` 为 `octafuse_gateway`。

## 变更

只更新 `model_routes.adapter`，不改列、不改计费。

- 供应商模型名以 `qwen-audio-` 开头、适配器为 `dashscope-tts-speech` 的行，改为 `dashscope-tts-qwen-audio`。CosyVoice 仍留在 `dashscope-tts-speech`。
- 适配器为 `dashscope-asr-file-async` 且模型名对得上系列的行，分别改为 `dashscope-asr-qwen-audio-file-async`、`dashscope-asr-qwen-file-async`、`dashscope-asr-fun-async`、`dashscope-asr-paraformer-async`。
- 对不上这些模型名的异步行留在 `dashscope-asr-file-async`。新版本里它们要改成新适配器之后才能继续用。
- 透传行仍是 `passthrough`，不在这次改写范围内。

## 步骤

1. 备份后对目标库执行对应 `0032_split_audio_adapter_families.sql`（或官方 migrate）。
2. 再执行 0033，然后滚动更新同版本 Proxy 与 Admin。先更新应用时，已改名的路由在旧进程上不可用；先改库、后更新应用时，新适配器名在旧进程上同样不可用。不要让新旧进程同时接这些路由的流量。

## 回滚

按模型名把上述适配器改回 `dashscope-tts-speech` 或 `dashscope-asr-file-async`，再回退 Proxy / Admin。只回退应用、不改回适配器名时，旧进程不认识新名字。
