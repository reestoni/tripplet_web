import type { Me } from "../api";

export default function Home({ me }: { me: Me }) {
  const first = me.user.first_name || me.user.username;
  return (
    <div className="page">
      <h1>Welcome, {first}</h1>
      <div className="card">
        <p>
          This is the web version of TrippleT. It is being built step by step and uses the same database as the
          desktop app.
        </p>
        <p className="muted">
          Connected to <b>{me.db}</b> ({me.mode}) · access level {me.user.access_level}
          {me.user.access_right ? ` (${me.user.access_right})` : ""}
        </p>
        <p className="muted">Entries shown in grey in the sidebar are not available in the web version yet.</p>
      </div>
    </div>
  );
}
