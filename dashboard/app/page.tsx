import { redirect } from 'next/navigation';

// Redirect root to default locale (Russian)
export default function RootPage() {
  redirect('/ru');
}
