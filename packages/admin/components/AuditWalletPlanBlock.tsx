import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import type { AuditWalletSnapshotDiff } from '@/lib/audit-user-snapshot-diff';

const highlight = {
	before: 'rounded px-0.5 bg-amber-50 text-amber-900',
	after: 'rounded px-0.5 bg-sky-50 text-sky-900',
} as const;

function MoneyArrow({
	before,
	after,
	changed,
	currency,
}: {
	before: number;
	after: number;
	changed: boolean;
	currency: string;
}) {
	if (!changed) {
		return <>{formatGatewayMoneyCode(after, currency, GATEWAY_MONEY_DECIMAL_PLACES)}</>;
	}
	return (
		<>
			<span className={highlight.before}>
				{formatGatewayMoneyCode(before, currency, GATEWAY_MONEY_DECIMAL_PLACES)}
			</span>
			<span className="text-gray-400"> → </span>
			<span className={highlight.after}>
				{formatGatewayMoneyCode(after, currency, GATEWAY_MONEY_DECIMAL_PLACES)}
			</span>
		</>
	);
}

/** 审计表「永久额度 / Wallet」列：发放、消耗、余额；仅变化时显示 before → after。 */
export function AuditWalletPlanBlock({
	diff,
	currency,
	labels,
}: {
	diff: AuditWalletSnapshotDiff;
	currency: string;
	labels: { granted: string; spent: string; remaining: string };
}) {
	if (!diff.hasSnapshot) {
		return <span className="text-gray-400">—</span>;
	}
	return (
		<div className="space-y-1 leading-snug">
			<div>
				<span className="font-medium text-gray-700">{labels.granted}</span>{' '}
				<MoneyArrow
					before={diff.beforeGranted}
					after={diff.afterGranted}
					changed={diff.grantedChanged}
					currency={currency}
				/>
			</div>
			<div>
				<span className="font-medium text-gray-700">{labels.spent}</span>{' '}
				<MoneyArrow
					before={diff.beforeSpent}
					after={diff.afterSpent}
					changed={diff.spentChanged}
					currency={currency}
				/>
			</div>
			<div>
				<span className="font-medium text-gray-700">{labels.remaining}</span>{' '}
				<MoneyArrow
					before={diff.beforeRemaining}
					after={diff.afterRemaining}
					changed={diff.remainingChanged}
					currency={currency}
				/>
			</div>
		</div>
	);
}
