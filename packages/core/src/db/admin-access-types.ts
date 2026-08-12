export type AdminApiKeyStatus = 'active' | 'revoked';

export interface AdminApiKeyRow {
	id: string;
	name: string;
	description: string | null;
	secretKey: string;
	keyPrefix: string;
	permissionsJson: string;
	status: AdminApiKeyStatus;
	lastUsedAt: string | null;
	createdAt: string;
	updatedAt: string;
	revokedAt: string | null;
}

export interface AdminSessionRow {
	tokenHash: string;
	username: string;
	createdAt: string;
	expiresAt: string;
}

export interface InsertAdminApiKeyParams {
	id: string;
	name: string;
	description?: string | null;
	secretKey: string;
	keyPrefix: string;
	permissionsJson: string;
}
