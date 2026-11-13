import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, ApiError, type Me } from "./api";
import Login from "./pages/Login";
import Shell from "./components/Shell";
import Home from "./pages/Home";
import NotYet from "./pages/NotYet";
import AllExperiments from "./pages/AllExperiments";
import Backlog from "./pages/Backlog";
import SeriesView from "./pages/SeriesView";
import SeriesReport from "./pages/SeriesReport";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setMe(null);
      if (!(e instanceof ApiError && e.status === 401)) {
        setError("app.serverDown");
      }
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  if (!checked) return null;
  if (!me) return <Login onLoggedIn={loadMe} startupError={error} />;

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setMe(null);
    }
  };

  return (
    <Shell me={me} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Home me={me} />} />
        <Route path="/experiments" element={<AllExperiments />} />
        <Route path="/backlog" element={<Backlog />} />
        <Route path="/series/:id" element={<SeriesView accessLevel={me.user.access_level} />} />
        <Route path="/series/:id/report" element={<SeriesReport />} />
        <Route path="*" element={<NotYet />} />
      </Routes>
    </Shell>
  );
}
