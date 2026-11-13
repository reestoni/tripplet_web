import { Link, useLocation } from "react-router-dom";

export default function NotYet() {
  const { pathname } = useLocation();
  return (
    <div className="page">
      <h1>Not in the web version yet</h1>
      <div className="card">
        <p>
          <code>{pathname}</code> is not available in the web version yet. Please use the TrippleT desktop app for
          this for now.
        </p>
        <Link to="/">Back to the start page</Link>
      </div>
    </div>
  );
}
