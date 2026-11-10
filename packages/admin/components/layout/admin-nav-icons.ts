import type { ComponentType } from "react";
import type { AdminNavNameKey } from "@/lib/admin-nav";
import {
	HomeIcon,
	KeyIcon,
	CpuChipIcon,
	GlobeAltIcon,
	ArrowsRightLeftIcon,
	BeakerIcon,
	PlayCircleIcon,
	DocumentChartBarIcon,
	ClipboardDocumentListIcon,
	ChartBarIcon,
	ServerStackIcon,
	UsersIcon,
	ShieldCheckIcon,
	Cog6ToothIcon,
	PauseCircleIcon,
	WrenchScrewdriverIcon,
	QueueListIcon,
	Squares2X2Icon,
} from "@heroicons/react/24/outline";

export const ADMIN_NAV_ICONS: Record<
	AdminNavNameKey,
	ComponentType<{ className?: string }>
> = {
	dashboard: HomeIcon,
	providers: GlobeAltIcon,
	models: CpuChipIcon,
	routes: ArrowsRightLeftIcon,
	playground: BeakerIcon,
	simulator: PlayCircleIcon,
	users: UsersIcon,
	apiKeys: KeyIcon,
	requestLogs: DocumentChartBarIcon,
	auditLogs: ClipboardDocumentListIcon,
	toolsConfig: WrenchScrewdriverIcon,
	toolInvocations: QueueListIcon,
	mcpServers: Squares2X2Icon,
	modelUsage: ChartBarIcon,
	providerUsage: ServerStackIcon,
	userUsage: UsersIcon,
	reliability: ShieldCheckIcon,
	adminApiKeys: KeyIcon,
	config: Cog6ToothIcon,
	maintenance: PauseCircleIcon,
};
