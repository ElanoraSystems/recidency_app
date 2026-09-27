export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  locked?: boolean;
}

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/", icon: "dashboard" },
  { id: "tasks", label: "Tasks", path: "/tasks", icon: "tasks" },
  { id: "kitchen", label: "Kitchen", path: "/kitchen", icon: "kitchen" },
  { id: "housekeeping", label: "Housekeeping", path: "/housekeeping", icon: "housekeeping", locked: true },
  { id: "maintenance", label: "Maintenance", path: "/maintenance", icon: "maintenance", locked: true },
  { id: "inventory", label: "Inventory", path: "/inventory", icon: "inventory" },
  { id: "purchasing", label: "Purchasing", path: "/purchasing", icon: "purchasing" },
  { id: "vehicles", label: "Vehicles", path: "/vehicles", icon: "vehicles", locked: true },
  { id: "guests", label: "Guests", path: "/guests", icon: "guests", locked: true },
  { id: "events", label: "Events", path: "/events", icon: "events", locked: true },
  { id: "people", label: "People", path: "/people", icon: "people", locked: true },
  { id: "gardenpool", label: "Garden & Pool", path: "/garden-pool", icon: "garden", locked: true },
  { id: "documents", label: "Documents", path: "/documents", icon: "documents", locked: true },
  { id: "expenses", label: "Expenses", path: "/expenses", icon: "expenses", locked: true },
  { id: "patrol", label: "Patrol", path: "/patrol", icon: "patrol", locked: true },
  { id: "reports", label: "Reports", path: "/reports", icon: "reports", locked: true },
  { id: "settings", label: "Settings", path: "/settings", icon: "settings" },
];
