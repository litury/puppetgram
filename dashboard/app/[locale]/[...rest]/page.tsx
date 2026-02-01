import { notFound } from 'next/navigation';

// Catch-all route for unknown paths - triggers 404
export default function CatchAllPage() {
  notFound();
}
