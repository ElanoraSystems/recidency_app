import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Shell } from "./layout/Shell";
import { Approvals } from "./pages/Approvals";
import { Dashboard } from "./pages/Dashboard";
import { DocumentsPage } from "./pages/Documents";
import { EventsPage } from "./pages/Events";
import { ExpensesPage } from "./pages/Expenses";
import { GardenPoolPage } from "./pages/GardenPool";
import { GuestsPage } from "./pages/Guests";
import { Housekeeping } from "./pages/Housekeeping";
import { InventoryPage } from "./pages/Inventory";
import { Kitchen } from "./pages/Kitchen";
import { Login } from "./pages/Login";
import { Maintenance } from "./pages/Maintenance";
import { Patrol } from "./pages/Patrol";
import { People } from "./pages/People";
import { Purchasing } from "./pages/Purchasing";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { Tasks } from "./pages/Tasks";
import { VehiclesPage } from "./pages/Vehicles";
import { Spinner } from "./components/ui";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="people" element={<People />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="housekeeping" element={<Housekeeping />} />
        <Route path="kitchen" element={<Kitchen />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="purchasing" element={<Purchasing />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="patrol" element={<Patrol />} />
        <Route path="garden-pool" element={<GardenPoolPage />} />
        <Route path="guests" element={<GuestsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
