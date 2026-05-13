/**
 * Proxy 在 `api_key_request_logs.status = error` 时可选调用的群机器人 Webhook。
 * 写入 `system_config`；**非空 URL 即启用**对应渠道，未配置则不发告警。
 */

/** 企业微信「群机器人」完整 Webhook URL（含 `key=`） */
export const ALERT_WEBHOOK_WECOM_URL_KEY = 'ALERT_WEBHOOK_WECOM_URL';

/** 飞书自定义机器人完整 Webhook URL */
export const ALERT_WEBHOOK_FEISHU_URL_KEY = 'ALERT_WEBHOOK_FEISHU_URL';
