export default function ProfileLoading() {
  return (
    <main
      className="main-scroll profile-page profile-page--attention-grid"
      aria-busy="true"
      aria-label="Loading collection profile"
    >
      <section className="profile-question">
        <h1>Collection Profile</h1>
        <p role="status">Loading your collection profile…</p>
      </section>
    </main>
  );
}
