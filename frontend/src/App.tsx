import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Shell } from "./layout/Shell";
import { Dashboard } from "./pages/Dashboard";
import { InventoryPage, StockCountEntryPage } from "./pages/Inventory";
import { Kitchen, NewRecipePage, RecipeDetailPage } from "./pages/Kitchen";
import { MealLogPage, TransferPage, WastePage } from "./pages/KitchenTransactions";
import { Login } from "./pages/Login";
import { NewPurchaseOrderPage, NewPurchaseRequestPage, Purchasing, ReceiveGoodsPage } from "./pages/Purchasing";
import { Settings } from "./pages/Settings";
import { Tasks } from "./pages/Tasks";
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
        <Route path="tasks" element={<Tasks />} />
        <Route path="kitchen" element={<Kitchen />} />
        <Route path="kitchen/meal-log/new" element={<MealLogPage />} />
        <Route path="kitchen/meal-log/:id" element={<MealLogPage />} />
        <Route path="kitchen/transfers/new" element={<TransferPage />} />
        <Route path="kitchen/transfers/:id" element={<TransferPage />} />
        <Route path="kitchen/waste/new" element={<WastePage />} />
        <Route path="kitchen/waste/:id" element={<WastePage />} />
        <Route path="kitchen/recipes/new" element={<NewRecipePage />} />
        <Route path="kitchen/recipes/:id" element={<RecipeDetailPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/counts/:countId" element={<StockCountEntryPage />} />
        <Route path="purchasing" element={<Purchasing />} />
        <Route path="purchasing/requests/new" element={<NewPurchaseRequestPage />} />
        <Route path="purchasing/orders/new/:prId" element={<NewPurchaseOrderPage />} />
        <Route path="purchasing/grn/:poId" element={<ReceiveGoodsPage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
