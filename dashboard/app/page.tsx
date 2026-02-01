'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Client-side redirect to default locale (Russian)
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ru');
  }, [router]);

  return null;
}
