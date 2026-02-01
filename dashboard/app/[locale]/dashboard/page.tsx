import { DashboardPageClient } from './DashboardPageClient';

// Generate static params for both locales (required for static export)
export function generateStaticParams() {
  return [{ locale: 'ru' }, { locale: 'en' }];
}

export default function DashboardPage() {
  return <DashboardPageClient />;
}
