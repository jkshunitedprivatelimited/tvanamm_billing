export default function Loading() {
  return (
    <main className="billing-loading" role="status" aria-live="polite" aria-busy="true">
      <strong>T VANAMM</strong>
      <p>Opening billing…</p>
      <div className="loading-search" aria-hidden="true" />
      <div className="loading-items" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} />
        ))}
      </div>
    </main>
  );
}
