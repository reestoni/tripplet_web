import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, ApiError, type Me } from "./api";
import Login from "./pages/Login";
import Shell from "./components/Shell";
import KnowledgeBase from "./pages/KnowledgeBase";
import NotYet from "./pages/NotYet";
import AllExperiments from "./pages/AllExperiments";
import Backlog from "./pages/Backlog";
import SeriesView from "./pages/SeriesView";
import SeriesReport from "./pages/SeriesReport";
import MyRequests from "./pages/MyRequests";
import RequestForm from "./pages/RequestForm";
import CreateExperiment from "./pages/CreateExperiment";
import ManageJets from "./pages/ManageJets";
import ManageYarn from "./pages/ManageYarn";
import YarnStock from "./pages/YarnStock";
import StockTake from "./pages/StockTake";
import ManageUsers from "./pages/ManageUsers";
import Settings from "./pages/Settings";
import SmartChart from "./pages/SmartChart";
import Dashboards from "./pages/Dashboards";
import RecycleBin from "./pages/RecycleBin";
import ManageMaster from "./pages/ManageMaster";
import QuickScan, { RequirementHub } from "./pages/QuickScan";
import ProcessPlayground from "./pages/ProcessPlayground";
import Canvas from "./pages/Canvas";
import TdmsInspector from "./pages/TdmsInspector";
import LabelGenerator from "./pages/LabelGenerator";
import ImageCompare from "./pages/ImageCompare";
import AirSupply from "./pages/AirSupply";
import JetRoi from "./pages/JetRoi";
import YarnCount from "./pages/YarnCount";
import { DisplayProvider } from "./display";

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
      setError(e instanceof ApiError && e.status === 401 ? null : "app.serverDown");
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);
  // server not reachable (e.g. backend restarting): try again every 3 s, the login page updates by itself
  useEffect(() => {
    if (error !== "app.serverDown") return;
    const h = window.setInterval(() => {
      fetch("/api/health").then((r) => { if (r.ok) loadMe(); }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(h);
  }, [error, loadMe]);

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
    <DisplayProvider initial={me.display}>
    <Shell me={me} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Navigate to={me.start_route || "/backlog"} replace />} />
        <Route path="/experiments" element={<AllExperiments />} />
        <Route path="/backlog" element={<Backlog />} />
        <Route path="/experiments/new" element={<CreateExperiment key="create" mode="create" />} />
        <Route path="/experiments/legacy" element={<CreateExperiment key="legacy" mode="legacy" />} />
        <Route path="/series/new" element={<CreateExperiment key="addseries" mode="addseries" />} />
        <Route path="/series/:id/add-trials" element={<CreateExperiment key="addtrials" mode="addtrials" />} />
        <Route path="/lab-machines/new" element={<CreateExperiment key="addlab" mode="addlab" />} />
        <Route path="/series/:id" element={<SeriesView accessLevel={me.user.access_level} />} />
        <Route path="/series/:id/report" element={<SeriesReport />} />
        <Route path="/requests" element={<MyRequests />} />
        <Route path="/requests/new" element={<RequestForm />} />
        <Route path="/requests/:id" element={<RequestForm />} />
        <Route path="/admin/jets" element={<ManageJets />} />
        <Route path="/admin/yarn" element={<ManageYarn />} />
        <Route path="/tools/yarn-stock" element={<YarnStock />} />
        <Route path="/tools/yarn-stock/stock-take" element={<StockTake />} />
        <Route path="/superuser/users" element={<ManageUsers />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/tools/smart-chart" element={<SmartChart key={"sc"} />} />
        <Route path="/tools/dashboards" element={<Dashboards />} />
        <Route path="/superuser/recycle-bin" element={<RecycleBin />} />
        <Route path="/admin/top-plates" element={<ManageMaster key="top_plates" kind="top_plates" />} />
        <Route path="/admin/order-types" element={<ManageMaster key="order_types" kind="order_types" />} />
        <Route path="/admin/product-groups" element={<ManageMaster key="product_groups" kind="product_groups" />} />
        <Route path="/admin/material" element={<ManageMaster key="material" kind="material" />} />
        <Route path="/tools/requirement-hub" element={<RequirementHub />} />
        <Route path="/tools/requirement-hub/quick-scan" element={<QuickScan />} />
        <Route path="/tools/process-playground" element={<ProcessPlayground />} />
        <Route path="/tools/canvas" element={<Canvas />} />
        <Route path="/tools/tdms-inspector" element={<TdmsInspector />} />
        <Route path="/tools/label-generator" element={<LabelGenerator />} />
        <Route path="/tools/image-compare" element={<ImageCompare />} />
        <Route path="/tools/air-supply" element={<AirSupply />} />
        <Route path="/tools/jet-roi" element={<JetRoi />} />
        <Route path="/tools/yarn-count" element={<YarnCount />} />
        <Route path="/knowledge-base" element={<KnowledgeBase />} />
        <Route path="/knowledge-base/:key" element={<KnowledgeBase />} />
        <Route path="*" element={<NotYet />} />
      </Routes>
    </Shell>
    </DisplayProvider>
  );
}
