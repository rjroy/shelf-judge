export default function CollectionLoading() {
  return (
    <main className="main-scroll" aria-busy="true" aria-label="Loading collection">
      <div className="topbar">
        <h1 className="topbar-title">My Collection</h1>
      </div>
      <p className="collection-route-loading" role="status">
        Loading your games…
      </p>
      <noscript>
        <style>{`.collection-route-loading { display: none !important; }`}</style>
        <p>
          JavaScript is required to load and use your Collection. Enable JavaScript and reload this
          page.
        </p>
      </noscript>
    </main>
  );
}
