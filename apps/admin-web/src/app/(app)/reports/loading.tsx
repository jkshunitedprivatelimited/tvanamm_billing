export default function LoadingReports() {
  return (
    <main aria-busy="true">
      <h1>Reports</h1>
      <div className="card" role="status">
        <span className="spinner" /> Loading your outlet reports…
      </div>
    </main>
  );
}
