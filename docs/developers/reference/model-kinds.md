# 模型类型（Model Kinds）

模型类型（Kind）决定一个目录模型出现在哪个列表、走哪组路由适配器、用哪种计费界面，以及 Proxy 是否放行某个入口。Kind **不单独落库**，由模型已有字段（`input_modalities`、`output_modalities`、`pricing_profile`）派生。派生规则只有一份实现：

- 判定函数：`packages/core/src/db/model-kind.ts` 的 `resolveModelKind`（需要排查依据时用 `explainModelKind`）。
- Admin、Proxy、适配器注册表都从这里取值，不允许再各自写一套判断。

## 取值与各处的对应关系

Kind 共 5 个：`llm`、`image`、`asr`、`tts`、`embedding`。

| Kind | 含义 | 管理后台中文界面 | `GET /v1/models?kind=` | 适配器注册表 `modelKind` | 典型入口 |
| ---- | ---- | --------------------- | ---------------------- | ------------------------ | -------- |
| `llm` | 对话 / 补全，含多模态看图、看音频的 LLM | 大语言模型 | `llm`（默认） | `llm` | `/v1/chat/completions`、`/v1/messages`、`/v1/responses` |
| `image` | 文生图 | 文生图 | `image` | `image` | `/v1/images/*` |
| `asr` | 语音识别（语音转文字） | 语音识别 | `asr`、`audio` | `asr` | `/v1/audio/transcriptions` |
| `tts` | 语音合成（文字转语音） | 语音合成 | `tts`、`audio` | `tts` | `/v1/audio/speech` |
| `embedding` | 向量 | 向量 | `embedding` | `embedding` | `/v1/embeddings` |

补充约定：

- `GET /v1/models` 的 `kind` 还接受 `audio`（ASR 与 TTS 合并，兼容旧写法）和 `all`（不过滤）。非法值回退为 `llm`。
- 管理后台调试台与模拟器在上述 5 个 Kind 之外多一个 `tool`（Agent 工具），它不是模型 Kind。
- 请求日志的类型来自实际调用的计费类型与操作，目录模型只在无法判断时兜底，规则见 `request-log-display.ts`。
- 旧链接里的 `?kind=audio`（Admin 页面 URL 与浏览器本地保存值）会落到 `asr`；公开接口 `GET /v1/models?kind=audio` 保持原义。

## 判定顺序

按下列顺序取第一个命中的结果。

| 顺序 | 条件 | 结果 | `explainModelKind` 的 source |
| ---- | ---- | ---- | ---------------------------- |
| 1 | `output_modalities` 含 `embedding` | `embedding` | `output_modalities` |
| 2 | `output_modalities` 含 `image` | `image` | `output_modalities` |
| 2a | `output_modalities` 缺失，且旧版 `pricing_profile.image` 存在 | `image` | `legacy_pricing` |
| 3 | `audio_billing_mode` 有效：`per_character` 且有 `audio.price_per_character` | `tts` | `billing` |
| 3 | `audio_billing_mode` 有效：`per_second` 且有 `audio` 块，或 `token` 且 `tiers` 非空 | `asr` | `billing` |
| 4 | 没有有效计费模式时按模态签名（见下表） | `asr` / `tts` | `modality_signature` |
| 5 | 其余 | `llm` | `default` |

要点：

- **计费模式优先于模态签名**。计费模式要求「模式与负载同时合法」才算有效，例如 `per_second` 但缺少 `audio` 块，不会判成 `asr`，而是继续看模态签名。
- 判断 `image` 只看 **输出**模态。多模态 LLM 的输入常含 `image`，不能据此判成文生图。
- 输出模态缺失时才会回退到旧版 `pricing_profile.image`；输出模态明确存在时不再看旧字段。
- 输入模态同样不能用来判断 LLM：多模态 LLM 会接收图片、音频、视频。

### 模态签名

只在没有有效 `audio_billing_mode` 时使用，且要求签名**完全吻合**。

| `output_modalities` | `input_modalities` | 结果 | 说明 |
| ------------------- | ------------------ | ---- | ---- |
| 仅 `audio` | 缺失，或只含 `text` | `tts` | 如 `text → audio` |
| 仅 `text` | 含 `audio`，且只有 `audio` / `text` | `asr` | 如 `audio → text`、`audio + text → text` |
| `text` + `audio` | 含图片 / 视频等 | `llm` | 全模态（Omni）模型，如 `qwen3.5-omni`：会说话，但仍走对话入口 |
| 仅 `text` | 含 `image` / `video` / `audio` | `llm` | 多模态看图、看音频的 LLM |
| 其它 | 任意 | `llm` | 兜底 |

## 保存时的一致性校验

管理后台创建、修改模型时，会用 `validateModelKindConsistency` 拒绝互相矛盾的配置，返回 400 和具体原因。缺失的模态不视为冲突（兼容尚未补全模态的历史数据）。

| 配置 | 判为冲突的情形 |
| ---- | -------------- |
| `audio_billing_mode=per_character`（TTS） | 输出模态已填写但不含 `audio` |
| `audio_billing_mode=per_second` / `token`（ASR） | 输出模态含 `audio`；或输入模态已填写但不含 `audio` |
| 任一音频计费模式 | 输出模态含 `embedding` 或 `image` |
| 输出模态 | 同时含 `embedding` 与 `image` / `audio` |

更新模型时，只要请求里带了 `input_modalities`、`output_modalities`、`pricing_profile` 中任意一个，就会和库里的现有值合并后再校验。

静态预设同样受此约束：`lib/services/admin/model-kind-presets.test.ts` 会遍历全部预设，任何矛盾都会让测试失败。

## 分类与入口守卫

Kind 回答「它是什么模型」；Proxy 的音频入口还要回答「能不能放行」。两者刻意分开：

- `checkAudioModelGuard(model, 'asr' | 'tts')` 先要求 Kind 吻合，再要求音频计费就绪（ASR 需要 `per_second` 或 `token`，TTS 需要 `per_character`）。
- 计费未就绪的模型即使按模态签名被判成 `asr` / `tts`，也不会被受理，避免没有定价却产生调用。
- 两种失败给出不同的错误信息：「模型类型不符」与「缺少音频计费」。

代码见 `packages/proxy/src/routes/v1/audio-model-guard.ts`，被 MiniMax T2A、ElevenLabs 语音合成与转写、DashScope 语音合成与文件转写入口使用。

## 管理后台里的 Kind

- 新建 / 编辑模型：Kind 分段控件直接选 **ASR** 或 **TTS**，没有「音频能力」二级开关。切换 Kind 时会同步默认输入输出模态与计费方式：
  - ASR：输入 `audio`、输出 `text`；计费可选按秒或 Token。
  - TTS：输入 `text`、输出 `audio`；只支持按字符计费。
- 模型页、路由页、调试台、模拟器的 Kind 筛选都使用同一组取值，URL 参数为 `?kind=asr` 等。
- 预设目录（导入面板）每条预设的 `kind` 同样由 `resolveModelKind` 算出。

## 新增 Kind 或新类型模型的检查清单

1. **先判断是否真需要新 Kind**。只是新的厂商、协议或计费细节，复用现有 Kind；只有入口、计费方式和 UI 都不同才新增。
2. 在 `packages/core/src/db/model-kind.ts` 增加取值，并补判定与一致性规则；更新本文的表格。
3. 补 `model-kind.test.ts` 里的表驱动用例，包括容易误判的反例。
4. 适配器注册表（`packages/core/src/adapters/registry.ts`）按 Kind 登记适配器；`AdapterModelKind` 直接取自 `ModelKind`，类型会提示漏改的位置。
5. Proxy：`GET /v1/models` 的 `kind` 过滤（`MODEL_KIND_QUERY_FILTERS`）、对应入口的守卫与计费。
6. Admin：Kind 分段控件、筛选侧栏、模型卡片、导入面板，以及四个语言的文案（`en`、`zh`、`ja`、`ko`）。
7. 新增模型预设时跑一遍 `npm run test:unit -w @octafuse/admin`，一致性测试会指出矛盾。
8. 在 `CHANGELOG.md` 的 `## Unreleased` 记录用户可见变化。

## 相关文档

- 公开接口 `kind` 参数：[用户接口 · 模型列表](../api/user.md)
- `pricing_profile` 计费字段：[管理接口 · pricing_profile](../api/admin.md#pricing_profile--price_override-契约adminmodelsadminroutes)
- 引入新模型的流程：`.cursor/rules/add-new-model.mdc`
- 文生图专题：[文生图模型](./image-models.md)
