import type { RouteResult } from './model-router';

export type RequestTimingAttempt = {
	index: number;
	provider_id: string;
	provider_name: string | null;
	provider_key_id: string | null;
	provider_key_label: string | null;
	provider_key_fingerprint: string | null;
	model: string | null;
	start_ms: number;
	headers_ms: number | null;
	headers_elapsed_ms: number | null;
	status: number | null;
	error: string | null;
	selected: boolean;
};

export type RequestTimingSnapshot = {
	gatewayOverheadMs: number | null;
	upstreamResponseMs: number | null;
	finalUpstreamHeadersMs: number | null;
	firstTokenMs: number | null;
	streamDurationMs: number | null;
	upstreamAttemptCount: number;
	upstreamFailoverCount: number;
	timingMetadata: string | null;
};

function now(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

function ms(value: number): number {
	return Math.max(0, Math.round(value));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class RequestTimingCollector {
	private readonly startedAt = now();
	private dispatchStartedAt: number | null = null;
	private dispatchStartedMs: number | null = null;
	private finalHeadersAt: number | null = null;
	private gatewayOverheadMs: number | null = null;
	private upstreamResponseMs: number | null = null;
	private finalUpstreamHeadersMs: number | null = null;
	private firstByteMs: number | null = null;
	private firstEventMs: number | null = null;
	private firstTokenMs: number | null = null;
	private streamDurationMs: number | null = null;
	private streamCompletedAt: number | null = null;
	private upstreamFailoverCount = 0;
	private readonly attempts: RequestTimingAttempt[] = [];

	elapsed(): number {
		return ms(now() - this.startedAt);
	}

	markGatewayComplete(): void {
		if (this.gatewayOverheadMs != null) return;
		this.gatewayOverheadMs = this.elapsed();
	}

	markUpstreamDispatchStart(): void {
		if (this.dispatchStartedAt != null) return;
		this.dispatchStartedAt = now();
		this.dispatchStartedMs = this.elapsed();
	}

	startAttempt(route: RouteResult): RequestTimingAttempt {
		this.markUpstreamDispatchStart();
		const attempt: RequestTimingAttempt = {
			index: this.attempts.length + 1,
			provider_id: route.providerId,
			provider_name: route.providerName || null,
			provider_key_id: route.providerKeyId ?? null,
			provider_key_label: route.providerKeyLabel ?? null,
			provider_key_fingerprint: route.providerKeyFingerprint ?? null,
			model: route.providerModelName ?? null,
			start_ms: this.elapsed(),
			headers_ms: null,
			headers_elapsed_ms: null,
			status: null,
			error: null,
			selected: false,
		};
		this.attempts.push(attempt);
		return attempt;
	}

	markAttemptHeaders(attempt: RequestTimingAttempt | undefined, status: number): void {
		if (!attempt || attempt.headers_ms != null) return;
		const elapsed = this.elapsed();
		attempt.headers_ms = ms(elapsed - attempt.start_ms);
		attempt.headers_elapsed_ms = elapsed;
		attempt.status = status;
	}

	markAttemptError(attempt: RequestTimingAttempt | undefined, error: unknown): void {
		if (!attempt) return;
		attempt.error = errorMessage(error).slice(0, 300);
	}

	markAttemptFailover(attempt: RequestTimingAttempt | undefined): void {
		if (!attempt) return;
		this.upstreamFailoverCount += 1;
	}

	markFinalAttempt(attempt: RequestTimingAttempt | undefined): void {
		if (!attempt) return;
		attempt.selected = true;
		if (attempt.headers_elapsed_ms != null && this.dispatchStartedMs != null && this.upstreamResponseMs == null) {
			this.upstreamResponseMs = ms(attempt.headers_elapsed_ms - this.dispatchStartedMs);
		}
		if (attempt.headers_ms != null && this.finalUpstreamHeadersMs == null) {
			this.finalUpstreamHeadersMs = attempt.headers_ms;
		}
		if (this.finalHeadersAt == null && attempt.headers_elapsed_ms != null) {
			this.finalHeadersAt = this.startedAt + attempt.headers_elapsed_ms;
		}
		if (this.finalHeadersAt != null && this.streamCompletedAt != null && this.streamDurationMs == null) {
			this.streamDurationMs = ms(this.streamCompletedAt - this.finalHeadersAt);
		}
	}

	markFirstByte(): void {
		if (this.firstByteMs != null) return;
		this.firstByteMs = this.elapsed();
	}

	markFirstEvent(): void {
		if (this.firstEventMs != null) return;
		this.firstEventMs = this.elapsed();
	}

	markFirstToken(): void {
		if (this.firstTokenMs != null) return;
		this.firstTokenMs = this.elapsed();
	}

	markStreamComplete(): void {
		if (this.streamDurationMs != null) return;
		this.streamCompletedAt = now();
		if (this.finalHeadersAt == null) return;
		this.streamDurationMs = ms(this.streamCompletedAt - this.finalHeadersAt);
	}

	snapshot(): RequestTimingSnapshot {
		const metadata = {
			first_byte_ms: this.firstByteMs,
			first_event_ms: this.firstEventMs,
			attempts: this.attempts,
		};
		const hasMetadata =
			this.firstByteMs != null ||
			this.firstEventMs != null ||
			this.attempts.length > 0;
		return {
			gatewayOverheadMs: this.gatewayOverheadMs,
			upstreamResponseMs: this.upstreamResponseMs,
			finalUpstreamHeadersMs: this.finalUpstreamHeadersMs,
			firstTokenMs: this.firstTokenMs,
			streamDurationMs: this.streamDurationMs,
			upstreamAttemptCount: this.attempts.length,
			upstreamFailoverCount: this.upstreamFailoverCount,
			timingMetadata: hasMetadata ? JSON.stringify(metadata) : null,
		};
	}
}
