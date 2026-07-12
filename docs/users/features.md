# 功能地图

Octafuse Gateway 的核心目标是把多个上游模型供应商、账号计划和 API Key 统一成一个 Gateway 入口，并在这个入口上做路由、预算、日志、审计和成本口径沉淀。

## 核心组件

| 概念 | 作用 |
|------|------|
| Proxy | 对外推理入口，提供 OpenAI / Anthropic / Gemini 兼容接口。 |
| Admin | 管理 UI 与 `/api/admin/*`，用于维护 Provider、模型、路由、用户、Key、日志与配置。 |
| Provider | 一个上游模型供应商或兼容端点，例如 OpenAI、Anthropic、Gemini、自建兼容服务。 |
| Provider API Key | Provider 下可轮换、限流、熔断的真实上游密钥。 |
| Model / Route | Gateway 暴露给客户端的模型入口，以及它如何路由到上游 Provider。 |
| Route group | 同一个模型 ID 下的分组能力，例如默认组、灰度组、不同协议组。 |
| User / API Key | Gateway 发给实际使用方的身份与访问密钥，可绑定预算、状态和元数据。 |

## 主要能力

| 能力 | 说明 |
|------|------|
| 统一入口 | 客户端只需要配置 Gateway Base URL 和用户 Key。 |
| 多协议兼容 | 支持 OpenAI Chat Completions、Anthropic Messages、Gemini `v1beta` 风格入口。 |
| 路由与故障转移 | 同一模型可配置多条上游路由，按优先级、权重、可用性和 key pool 状态调度。 |
| 预算与计费 | 按用户 Key 记录请求、Token、成本与扣费，支持周期预算和用量查询。每次请求区分 **供应成本**、**目录标准价**、**用户计费** 三笔账，便于对账与毛利分析。路由可配基础倍率与**每日时段倍率**（业务时区下的高峰 / 闲时），对齐各家模型按时段定价。 |
| Provider Key 管理 | 对上游 Key 做状态、RPM / TPM、并发、熔断和 sticky 配置。 |
| 日志与审计 | 请求日志记录调用链路，审计日志记录预算扣减、用户与 Key 生命周期等事件。 |
| Playground / Simulator | 在 Admin 内测试路由与客户端调用，不需要来回切换供应商控制台。 |
| 管理 API | 外部门户、后台或脚本可通过 `/api/admin/*` 自动创建用户、发 Key、同步预算和读取配置。 |

## 适合的使用方式

- 个人把多个 AI / Coding 资源聚合成一个入口，方便 IDE、命令行工具或其它客户端统一配置。
- 团队为成员、项目或客户发独立 Key，按预算和日志区分使用情况。
- 平台把 Gateway 接入自己的门户或后台，自动开通用户、同步预算并拉取审计数据。
- 运维人员在供应商不可用、额度不足或价格变化时，通过路由策略切换上游。

需要了解 API 和系统集成时，继续看 [developers/integration.md](../developers/integration.md)。
