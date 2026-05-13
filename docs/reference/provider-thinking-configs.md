# 渠道模型思考参数配置说明

本文档用于说明不同渠道在开启“思考/推理”能力时，需要放在请求体中的个性化参数。

网关侧如何把 route 级 `custom_params` 与客户端请求体合并，见 [用户接口 · Route 默认参数合并](../api/user.md#route-默认参数合并)。

## 1. 七牛

参考文档：https://apidocs.qnaigc.com/402539887e0

### Claude、DeepSeek

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 1024
  }
}
```

### GPT

```json
{
  "reasoning": {
    "effort": "medium",
    "summary": "detailed"
  }
}
```

- `low`、`medium`、`high`

### Gemini

```json
{
  "reasoning_effort": "medium"
}
```

- `low`、`medium`、`high`、`ultra_high`

## 2. MiniMax 官方

参考文档：https://platform.minimaxi.com/docs/api-reference/text-openai-api

### minimax-m2.7

```json
{
  "reasoning_split": true
}
```

## 3. 火山引擎

### DeepSeek

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 1024
  }
}
```

## 4. 网宿

参考文档：https://www.wangsu.com/document/26920/41247

### Claude

```json
{
  "eca_thinking_config":{
    "type":"enabled",
    "budget_tokens":1024
  }
}
```

### Gemini

```json
{
  "reasoning_effort": "medium"
}
```

- 可选值：low、medium、high

## 5. Z.AI

参数以厂商当前文档为准；合并规则见 [用户接口 · Route 默认参数合并](../api/user.md#route-默认参数合并)。

## 备注

- 以上 JSON 为“附加参数”示例，需合并到具体接口请求体中（如 `/v1/chat/completions` 的请求体）。
- `budget_tokens`、`effort`、`summary` 等值可按模型能力和业务需求调整。
