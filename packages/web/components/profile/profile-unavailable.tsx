export function ProfileRetry({ message }: { message: string }) {
  return (
    <div className="profile-unavailable" data-profile-state="unavailable" role="alert">
      <p className="profile-status-label">Profile unavailable</p>
      <p>{message}</p>
      <form action="/" method="get">
        <button className="btn btn-primary" type="submit">
          Retry profile
        </button>
      </form>
    </div>
  );
}
