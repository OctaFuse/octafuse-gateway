import type { ModelFormData } from './types';

/** MySQL `models.id` is varchar(512); keep the suggested copy inside that limit. */
const MODEL_ID_MAX_LENGTH = 512;
const COPY_MODEL_ID_SUFFIX = '-copy';

/** Public catalog key for the copy. Blank stays blank so the operator still has to fill it in. */
export function copyModelId(id: string): string {
	const source = id.trim();
	if (!source) return '';
	const room = MODEL_ID_MAX_LENGTH - COPY_MODEL_ID_SUFFIX.length;
	const base = source.length > room ? source.slice(0, room) : source;
	return `${base}${COPY_MODEL_ID_SUFFIX}`;
}

/**
 * Turn the open model form into a create-form for a variant.
 * Model ID is the public catalog key and cannot be changed after save, so the copy
 * keeps the source id with a `-copy` suffix that the operator can still edit.
 */
export function modelFormForDuplicate(
	form: ModelFormData,
	formatCopyDisplayName: (name: string) => string
): ModelFormData {
	const name = form.display_name.trim();
	return {
		...form,
		id: copyModelId(form.id),
		display_name: name ? formatCopyDisplayName(name) : '',
		tags: [...form.tags],
		input_modalities: [...form.input_modalities],
		output_modalities: [...form.output_modalities],
	};
}
