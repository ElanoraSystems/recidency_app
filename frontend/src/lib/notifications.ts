import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  ApprovalItem, Area, DocumentItem, EventItem, Expense, FoodInventoryItem, Guest, InventoryItem,
  PatrolLogEntry, PmScheduleItem, ResidenceSettingsInfo, StaffMember, TaskItem, Vehicle,
} from "../types";
import { daysLabel, daysUntil, todayIso } from "./date";

interface AttendanceRow { id: string; staff_id: string; date: string; status: string }

export interface NotificationItem {
  id: string;
  title: string;
  sub: string;
  route: string;
  priority: "Critical" | "High" | "Medium";
  category: string;
}

export function routeForApproval(type: ApprovalItem["type"]): string {
  switch (type) {
    case "purchase_request":
    case "purchase_order":
      return "/purchasing";
    case "proposed_menu":
    case "weekly_meal_plan":
    case "waste_log":
      return "/kitchen";
    case "asset":
    case "maintenance_confirmation":
      return "/maintenance";
    case "leave_request":
      return "/people";
    case "task_review":
      return "/tasks";
    default:
      return "/approvals";
  }
}

export function useNotifications() {
  const approvals = useQuery<ApprovalItem[]>({
    queryKey: ["approvals"],
    queryFn: async () => (await api.get("/approvals")).data,
    staleTime: 30_000,
  });
  const documents = useQuery<DocumentItem[]>({
    queryKey: ["documents"],
    queryFn: async () => (await api.get("/documents")).data,
    staleTime: 60_000,
  });
  const inventory = useQuery<InventoryItem[]>({
    queryKey: ["inventory"],
    queryFn: async () => (await api.get("/inventory")).data,
    staleTime: 60_000,
  });
  const prefs = useQuery<Record<string, boolean>>({
    queryKey: ["notification-prefs"],
    queryFn: async () => (await api.get("/settings/notification-prefs")).data,
    staleTime: 60_000,
  });
  const foodInventory = useQuery<FoodInventoryItem[]>({
    queryKey: ["food-inventory"],
    queryFn: async () => (await api.get("/kitchen/food-inventory")).data,
    staleTime: 60_000,
  });
  const tasks = useQuery<TaskItem[]>({
    queryKey: ["tasks"],
    queryFn: async () => (await api.get("/tasks")).data,
    staleTime: 60_000,
  });
  const pmSchedule = useQuery<PmScheduleItem[]>({
    queryKey: ["pm-schedule"],
    queryFn: async () => (await api.get("/pm-schedule")).data,
    staleTime: 60_000,
  });
  const vehicles = useQuery<Vehicle[]>({
    queryKey: ["vehicles"],
    queryFn: async () => (await api.get("/vehicles")).data,
    staleTime: 60_000,
  });
  const attendance = useQuery<AttendanceRow[]>({
    queryKey: ["attendance"],
    queryFn: async () => (await api.get("/attendance")).data,
    staleTime: 60_000,
  });
  const staff = useQuery<StaffMember[]>({
    queryKey: ["staff"],
    queryFn: async () => (await api.get("/people/staff")).data,
    staleTime: 60_000,
  });
  const guests = useQuery<Guest[]>({
    queryKey: ["guests"],
    queryFn: async () => (await api.get("/guests")).data,
    staleTime: 60_000,
  });
  const events = useQuery<EventItem[]>({
    queryKey: ["events"],
    queryFn: async () => (await api.get("/events")).data,
    staleTime: 60_000,
  });
  const expenses = useQuery<Expense[]>({
    queryKey: ["expenses"],
    queryFn: async () => (await api.get("/expenses")).data,
    staleTime: 60_000,
  });
  const residence = useQuery<ResidenceSettingsInfo>({
    queryKey: ["residence"],
    queryFn: async () => (await api.get("/settings/residence")).data,
    staleTime: 60_000,
    retry: false,
  });
  const areas = useQuery<Area[]>({
    queryKey: ["areas"],
    queryFn: async () => (await api.get("/areas")).data,
    staleTime: 60_000,
  });
  const patrolLog = useQuery<PatrolLogEntry[]>({
    queryKey: ["patrol-log"],
    queryFn: async () => (await api.get("/patrol")).data,
    staleTime: 60_000,
    retry: false,
  });

  const enabled = (category: string) => prefs.data?.[category] ?? true;
  const today = todayIso();

  const notifications: NotificationItem[] = [];

  if (enabled("Pending approvals")) {
    for (const a of approvals.data ?? []) {
      notifications.push({ id: `${a.type}-${a.id}`, title: a.title, sub: a.sub, route: routeForApproval(a.type), priority: "Medium", category: "Pending approvals" });
    }
  }
  if (enabled("Expiring documents")) {
    for (const d of documents.data ?? []) {
      if (!d.expiry) continue;
      const n = daysUntil(d.expiry);
      if (n <= 14) {
        notifications.push({
          id: `doc-${d.id}`,
          title: n < 0 ? `${d.name} has expired` : `${d.name} expires soon`,
          sub: `${d.category} · ${daysLabel(n)}`,
          route: "/documents",
          priority: n <= 3 ? "Critical" : "High",
          category: "Expiring documents",
        });
      }
    }
  }
  if (enabled("Low inventory")) {
    for (const i of inventory.data ?? []) {
      if (i.stock < i.min) {
        notifications.push({
          id: `inv-${i.id}`,
          title: `${i.name} is below minimum stock`,
          sub: `${i.stock} ${i.unit} left (min ${i.min})`,
          route: "/inventory",
          priority: "High",
          category: "Low inventory",
        });
      }
    }
  }
  if (enabled("Expiring food")) {
    for (const f of foodInventory.data ?? []) {
      if (!f.expiry) continue;
      const n = daysUntil(f.expiry);
      if (n <= 3) {
        notifications.push({
          id: `food-${f.id}`,
          title: n < 0 ? `${f.name} has expired` : `${f.name} expires soon`,
          sub: `${f.category} · ${daysLabel(n)}`,
          route: "/kitchen",
          priority: n < 0 ? "Critical" : "High",
          category: "Expiring food",
        });
      }
    }
  }
  if (enabled("Overdue tasks")) {
    for (const t of tasks.data ?? []) {
      if (t.status === "Completed" || t.status === "Verified") continue;
      if (t.due_date < today) {
        notifications.push({
          id: `task-${t.id}`,
          title: `${t.title} is overdue`,
          sub: `${t.category} · due ${t.due_date}`,
          route: "/tasks",
          priority: "High",
          category: "Overdue tasks",
        });
      }
    }
  }
  if (enabled("Maintenance due")) {
    for (const p of pmSchedule.data ?? []) {
      const n = daysUntil(p.due_date);
      if (n <= 14) {
        notifications.push({
          id: `pm-${p.id}`,
          title: n < 0 ? `${p.task} is overdue` : `${p.task} due soon`,
          sub: daysLabel(n),
          route: "/maintenance",
          priority: n < 0 ? "Critical" : "High",
          category: "Maintenance due",
        });
      }
    }
  }
  if (enabled("Vehicle service due")) {
    for (const v of vehicles.data ?? []) {
      if (!v.next_service) continue;
      const n = daysUntil(v.next_service);
      if (n <= 14) {
        notifications.push({
          id: `vehicle-${v.id}`,
          title: n < 0 ? `${v.name} service is overdue` : `${v.name} service due soon`,
          sub: daysLabel(n),
          route: "/vehicles",
          priority: n < 0 ? "Critical" : "High",
          category: "Vehicle service due",
        });
      }
    }
  }
  if (enabled("Staff absence")) {
    for (const a of attendance.data ?? []) {
      if (a.date !== today || a.status !== "Absent") continue;
      const name = staff.data?.find((s) => s.id === a.staff_id)?.name ?? "A staff member";
      notifications.push({
        id: `absence-${a.id}`,
        title: `${name} is absent today`,
        sub: "Marked absent in Attendance",
        route: "/people",
        priority: "Medium",
        category: "Staff absence",
      });
    }
  }
  if (enabled("Upcoming guest")) {
    for (const g of guests.data ?? []) {
      const n = daysUntil(g.arrival);
      if (n >= 0 && n <= 3) {
        notifications.push({
          id: `guest-${g.id}`,
          title: `${g.name} arriving ${daysLabel(n)}`,
          sub: `${g.count} guest(s)${g.room ? ` · ${g.room}` : ""}`,
          route: "/guests",
          priority: n === 0 ? "High" : "Medium",
          category: "Upcoming guest",
        });
      }
    }
  }
  if (enabled("Upcoming event")) {
    for (const e of events.data ?? []) {
      const n = daysUntil(e.date);
      if (n >= 0 && n <= 7) {
        notifications.push({
          id: `event-${e.id}`,
          title: `${e.name} ${daysLabel(n)}`,
          sub: `${e.type}${e.location ? ` · ${e.location}` : ""}`,
          route: "/events",
          priority: n <= 1 ? "High" : "Medium",
          category: "Upcoming event",
        });
      }
    }
  }
  if (enabled("Budget exceeded") && residence.data) {
    const monthPrefix = today.slice(0, 7);
    const monthSpend = (expenses.data ?? [])
      .filter((e) => e.date.slice(0, 7) === monthPrefix)
      .reduce((sum, e) => sum + e.amount, 0);
    if (residence.data.monthly_budget > 0 && monthSpend > residence.data.monthly_budget) {
      notifications.push({
        id: "budget-exceeded",
        title: "Monthly budget exceeded",
        sub: `KWD ${monthSpend.toFixed(2)} spent of KWD ${residence.data.monthly_budget.toFixed(2)} budget`,
        route: "/expenses",
        priority: "High",
        category: "Budget exceeded",
      });
    }
  }

  if (enabled("Area not patrolled today") && patrolLog.data) {
    const patrolledAreaIds = new Set(
      (patrolLog.data ?? []).filter((p) => p.scanned_at.slice(0, 10) === today).map((p) => p.area_id)
    );
    for (const a of areas.data ?? []) {
      if (patrolledAreaIds.has(a.id)) continue;
      notifications.push({
        id: `patrol-${a.id}`,
        title: `${a.name} has not been patrolled today`,
        sub: "No QR check-in logged yet",
        route: "/patrol",
        priority: "Medium",
        category: "Area not patrolled today",
      });
    }
  }

  const isLoading = approvals.isLoading || documents.isLoading || inventory.isLoading || prefs.isLoading
    || foodInventory.isLoading || tasks.isLoading || pmSchedule.isLoading || vehicles.isLoading
    || attendance.isLoading || staff.isLoading || guests.isLoading || events.isLoading || expenses.isLoading;

  return { notifications, isLoading };
}
