export default function CollectionLoading() {
  return (
    <main className="main-scroll" aria-busy="true" aria-label="Loading collection">
      <div className="topbar">
        <h1 className="topbar-title">My Collection</h1>
      </div>
      <p role="status">Loading your games…</p>
    </main>
  );
}
