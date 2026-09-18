'use client';
import Link from 'next/link';
export default function StockError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <div className="service-unavailable card">
        <div className="service-icon" aria-hidden="true">
          ↻
        </div>
        <p className="eyebrow">Stock workspace</p>
        <h1>We couldn’t load stock right now</h1>
        <p className="page-intro">
          The stock service is unavailable. Please try again in a moment. If this continues, contact
          central support to check the stock connection.
        </p>
        <div className="row">
          <button onClick={reset}>Try again</button>
          <Link href="/" className="btn secondary">
            Back to outlets
          </Link>
        </div>
      </div>
    </main>
  );
}
