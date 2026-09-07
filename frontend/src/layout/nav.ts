export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
}

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/", icon: "dashboard" },
  { id: "approvals", label: "Approvals", path: "/approvals", icon: "inbox" },
  { id: "people", label: "People", path: "/people", icon: "people" },
  { id: "tasks", label: "Tasks", path: "/tasks", icon: "tasks" },
  { id: "housekeeping", label: "Housekeeping", path: "/housekeeping", icon: "housekeeping" },
  { id: "kitchen", label: "Kitchen", path: "/kitchen", icon: "kitchen" },
  { id: "inventory", label: "Inventory", path: "/inventory", icon: "inventory" },
  { id: "purchasing", label: "Purchasing", path: "/purchasing", icon: "purchasing" },
  { id: "maintenance", label: "Maintenance", path: "/maintenance", icon: "maintenance" },
  { id: "vehicles", label: "Vehicles", path: "/vehicles", icon: "vehicles" },
  { id: "patrol", label: "Patrol", path: "/patrol", icon: "patrol" },
  { id: "gardenpool", label: "Garden & Pool", path: "/garden-pool", icon: "garden" },
  { id: "guests", label: "Guests", path: "/guests", icon: "guests" },
  { id: "events", label: "Events", path: "/events", icon: "events" },
  { id: "expenses", label: "Expenses", path: "/expenses", icon: "expenses" },
  { id: "documents", label: "Documents", path: "/documents", icon: "documents" },
  { id: "reports", label: "Reports", path: "/reports", icon: "reports" },
  { id: "settings", label: "Settings", path: "/settings", icon: "settings" },
];
