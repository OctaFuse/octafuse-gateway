'use client';

/**
 * OAuth 应用（应用目录条目）的新增 / 编辑对话框。
 * 应用靠回调地址归类：注册实例（client_id）的回调地址命中某应用的白名单即归属它；
 * 多个应用共用同一回调地址时，用「客户端名称关键字」区分。
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AdminDialog } from '@/components/admin-dialog';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import presets from '@/lib/oauth-app-presets.json';
import type { OAuthApp } from '@/lib/oauth-access-token-types';

const inputClass =
	'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100';

export interface OAuthAppDraft {
	slug: string;
	name: string;
	redirect_uris: string[];
	client_name_patterns: string[];
}

export const OAUTH_APP_PRESETS: readonly OAuthAppDraft[] = presets;

const splitLines = (value: string) =>
	value
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean);

export function OAuthAppFormDialog({
	open,
	app,
	initial,
	onClose,
	onSaved,
}: {
	open: boolean;
	/** 传入则为编辑 */
	app: OAuthApp | null;
	/** 新增时的预填（预设导入） */
	initial: OAuthAppDraft | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const t = useTranslations('oauthAccessTokensPage.apps.form');
	const tCommon = useTranslations('common');
	const { notify } = useFeedback();
	const [name, setName] = useState('');
	const [slug, setSlug] = useState('');
	const [uris, setUris] = useState('');
	const [patterns, setPatterns] = useState('');
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		const source = app ?? initial;
		setName(source?.name ?? '');
		setSlug(source?.slug ?? '');
		setUris((source?.redirect_uris ?? []).join('\n'));
		setPatterns((source?.client_name_patterns ?? []).join('\n'));
	}, [open, app, initial]);

	const submit = async () => {
		setBusy(true);
		try {
			const payload = {
				name: name.trim(),
				redirect_uris: splitLines(uris),
				client_name_patterns: splitLines(patterns),
			};
			const response = await fetch(
				app ? `/api/admin/oauth/apps/${encodeURIComponent(app.id)}` : '/api/admin/oauth/apps',
				{
					method: app ? 'PATCH' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(app ? payload : { ...payload, slug: slug.trim() }),
				}
			);
			const data = await readApiJson(response);
			if (data.success) {
				notify('success', t('saved'));
				onSaved();
				onClose();
			} else {
				notify('error', data.message || t('saveFailed'));
			}
		} catch (error) {
			console.error('Save OAuth app error:', error);
			notify('error', t('saveFailed'));
		} finally {
			setBusy(false);
		}
	};

	return (
		<AdminDialog
			open={open}
			title={app ? t('editTitle') : t('createTitle')}
			hint={t('hint')}
			busy={busy}
			onClose={onClose}
			footer={
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={busy || !name.trim() || (!app && !slug.trim())}
						className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
					>
						{t('save')}
					</button>
				</div>
			}
		>
			<div className="space-y-4">
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label className="block">
						<span className="mb-1 block text-xs font-medium text-gray-500">{t('name')}</span>
						<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
					</label>
					<label className="block">
						<span className="mb-1 block text-xs font-medium text-gray-500">{t('slug')}</span>
						<input
							className={`${inputClass} font-mono disabled:bg-gray-50 disabled:text-gray-500`}
							value={slug}
							onChange={(e) => setSlug(e.target.value.toLowerCase())}
							disabled={Boolean(app)}
							maxLength={40}
							placeholder="chatgpt"
						/>
						<span className="mt-1 block text-xs text-gray-400">{t('slugHint')}</span>
					</label>
				</div>
				<label className="block">
					<span className="mb-1 block text-xs font-medium text-gray-500">{t('redirectUris')}</span>
					<textarea
						className={`${inputClass} min-h-[6rem] font-mono`}
						value={uris}
						onChange={(e) => setUris(e.target.value)}
						spellCheck={false}
						placeholder="https://example.com/oauth/callback"
					/>
					<span className="mt-1 block text-xs leading-5 text-gray-400">{t('redirectUrisHint')}</span>
				</label>
				<label className="block">
					<span className="mb-1 block text-xs font-medium text-gray-500">{t('patterns')}</span>
					<textarea
						className={`${inputClass} min-h-[4rem]`}
						value={patterns}
						onChange={(e) => setPatterns(e.target.value)}
						spellCheck={false}
					/>
					<span className="mt-1 block text-xs leading-5 text-gray-400">{t('patternsHint')}</span>
				</label>
			</div>
		</AdminDialog>
	);
}
