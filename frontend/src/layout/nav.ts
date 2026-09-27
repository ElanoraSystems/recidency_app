export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
}

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/", icon: "dashboard" },
  { id: "tasks", label: "Tasks", path: "/tasks", icon: "tasks" },
  { id: "kitchen", label: "Kitchen", path: "/kitchen", icon: "kitchen" },
  { id: "inventory", label: "Inventory", path: "/inventory", icon: "inventory" },
  { id: "purchasing", label: "Purchasing", path: "/purchasing", icon: "purchasing" },
  { id: "settings", label: "Settings", path: "/settings", icon: "settings" },
];
