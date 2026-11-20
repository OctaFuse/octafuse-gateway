export function StatusSwitchTrack({ checked, compact = false }: { checked: boolean; compact?: boolean }) {
	return (
		<span
			aria-hidden
			className={`inline-flex shrink-0 items-center rounded-full p-0.5 motion-safe:transition-colors ${compact ? 'h-4 w-7' : 'h-5 w-9'} ${checked ? 'bg-emerald-600' : 'bg-slate-500'}`}
		>
			<span className={`shrink-0 rounded-full bg-white shadow-sm motion-safe:transition-transform ${compact ? 'h-3 w-3' : 'h-4 w-4'} ${checked ? (compact ? 'translate-x-3' : 'translate-x-4') : ''}`} />
		</span>
	);
}
