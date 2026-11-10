import { redirect } from 'next/navigation';

// 维护模式已并入配置；保留旧地址以兼容书签与历史链接。
export default function LegacyMaintenancePage() {
	redirect('/gateway/config#config-panel-maintenance');
}
