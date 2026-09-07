import type { Me } from "../types";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner / Admin",
  manager: "Residence Manager",
  chef: "Chef",
  housekeeper: "Housekeeper",
  driver: "Driver",
  gardener: "Gardener",
  maintenance: "Maintenance Technician",
  accountant: "Accountant",
};

export function roleLabel(user: Me | null): string {
  if (!user) return "";
  if (user.user_type === "family") return "Family Login";
  if (user.role_key) return ROLE_LABELS[user.role_key] ?? user.role_key;
  return user.user_type;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
