import { checkAudioModelGuard, type ModelKindFields } from '@octafuse/core';

/**
 * 原生音频透传入口的模型守卫；通过返回 `null`，否则返回 400 的错误文案。
 * 区分“不是该类型模型”与“模型缺少计费配置”，便于运营定位。
 */
export function audioModelGuardMessage(
	model: ModelKindFields,
	expected: 'asr' | 'tts',
	routeLabel: string,
): string | null {
	const result = checkAudioModelGuard(model, expected);
	if (result === 'ok') return null;
	const noun = expected === 'tts' ? 'speech' : 'transcription';
	if (result === 'wrong_kind') return `${routeLabel} requires a ${noun} model`;
	const mode = expected === 'tts' ? 'per_character' : 'per_second or token';
	return `${routeLabel}: ${noun} model has no valid audio billing configured (expected audio_billing_mode ${mode})`;
}
