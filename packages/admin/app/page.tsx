/**
 * 根路径重定向至仪表盘（实际内容由 `/dashboard` 提供）。
 */
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/dashboard');
}
