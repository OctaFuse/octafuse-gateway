/**
 * 记账 sink 接缝。阶段一默认实现直接 flush（`recordUsage`），与抽取前行为一致。
 * 阶段二将在此插入 spool → flush；协议转发层不感知介质。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { recordUsage } from '../usage-tracker';
import type { AccountingEvent } from './types';

export type AccountingSink = {
	flush(event: AccountingEvent): Promise<void>;
};

export function createDirectFlushAccountingSink(repos: GatewayRepositories): AccountingSink {
	return {
		flush: (event) => recordUsage(repos, event),
	};
}
