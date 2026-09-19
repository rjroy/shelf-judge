export function ProfileRetry({ message }: { message: string }) {
  return (
    <div className="profile-unavailable" data-profile-state="unavailable" role="alert">
      <p className="profile-status-label">Profile unavailable</p>
      <p>Shelf Judge cannot reach its local service right now.</p>
      <p>Check that the Shelf Judge daemon is running, then retry.</p>
      <form action="/" method="get">
        <button className="btn btn-primary" type="submit">
          Retry profile
        </button>
      </form>
      <details>
        <summary>Technical details</summary>
        <pre>{message}</pre>
      </details>
    </div>
  );
}
