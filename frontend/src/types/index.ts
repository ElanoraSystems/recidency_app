export interface ShiftPattern {
  id: string;
  label: string;
}

export interface AreaType {
  id: string;
  label: string;
}

export interface MealCategory {
  id: string;
  label: string;
}

export interface TaskCategory {
  id: string;
  label: string;
}

export interface PatrolLogEntry {
  id: string;
  area_id: string | null;
  area_name: string | null;
  staff_id: string | null;
  staff_name: string | null;
  scanned_at: string;
  notes: string | null;
}

export interface WasteReason {
  id: string;
  label: string;
}

export interface CostCenter {
  id: string;
  label: string;
}

export type TxnStatus = "Draft" | "Submitted" | "Approved" | "Closed";

// Who/when for each workflow step; shared by every transaction document.
export interface TxnStamps {
  status: TxnStatus;
  logged_by_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  user_name: string | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

export interface StockBalanceItem {
  stock_type: "food" | "general";
  stock_id: string;
  name: string;
  unit: string;
  category: string;
  total_qty: number;
  total_value: number;
  by_location: Record<string, number>;
}

export interface StockBalances {
  cost_centers: CostCenter[];
  items: StockBalanceItem[];
}

export interface StockMovementRow {
  id: string;
  created_at: string;
  txn_type: string;
  txn_code: string | null;
  txn_id: string | null;
  item_name: string;
  stock_type: string;
  stock_id: string;
  unit: string;
  from_cost_center: string | null;
  to_cost_center: string | null;
  qty: number;
  unit_cost: number;
  total_value: number;
  user_name: string | null;
  status: string;
  is_reversal: boolean;
}

export interface WasteLogLine {
  id: string;
  food_inventory_id: string | null;
  item_master_id: string | null;
  ingredient_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_cost: number;
}

export interface WasteLog extends TxnStamps {
  id: string;
  code: string;
  date: string;
  cost_center_id: string;
  cost_center: string;
  reason: string;
  notes: string | null;
  total: number;
  reviewed_by_name: string | null;
  lines: WasteLogLine[];
}

export interface Me {
  id: string;
  user_type: "owner" | "staff" | "family";
  name: string;
  email: string | null;
  must_change_password: boolean;
  role_key: string | null;
  allowed_modules: string[];
}

export interface DashboardSummary {
  staff_onsite: number;
  todays_tasks: number;
  housekeeping_avg_completion: number;
  maintenance_pending: number;
  low_stock_items: number;
  purchasing_pending: number;
  today_spend: number;
  month_spend: number;
  upcoming_guests: number;
  upcoming_events: number;
}

export interface ApprovalItem {
  type: "purchase_request" | "purchase_order" | "proposed_menu" | "asset" | "leave_request" | "task_review" | "maintenance_confirmation" | "weekly_meal_plan" | "waste_log";
  id: string;
  title: string;
  sub: string;
  date: string | null;
}

export interface ActivityEntry {
  id: string;
  actor: string;
  role: string;
  action: string;
  detail: string | null;
  at: string;
}

export interface StaffMember {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string;
  department: string;
  role_key: string | null;
  supervisor_id: string | null;
  status: string;
  join_date: string | null;
  id_type: string | null;
  id_number: string | null;
  id_expiry: string | null;
  contract_type: string | null;
  contract_end: string | null;
  salary: number | null;
  salary_currency: string;
  emergency_contact: { name?: string; relation?: string; phone?: string };
  responsibilities: string[];
  uniform: string[];
  notes: string | null;
  off_site_role: boolean;
}

export interface RecipeIngredient {
  food_inventory_id: string | null;
  sub_recipe_id: string | null;
  name: string;
  unit: string;
  qty: number;
  cost_per_unit: number;
  yield_pct: number;
  line_cost: number;
  override_unit_id: string | null;
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  allergens: string[];
  notes: string | null;
  prep_loss_pct: number;
  raw_yield_g: number;
  portions: number | null; // fixed serving count; null = counted from the portion size
  portion_size_g: number;
  portion_size_custom: boolean; // false = derived from yield / portions
  cooking_method: string | null;
  method: string | null;
  ingredients: RecipeIngredient[];
  cost: {
    total_cost: number;
    final_yield_g: number;
    portions: number;
    cost_per_portion: number;
  };
}

export interface FoodInventoryItem {
  id: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  batch: string | null;
  expiry: string | null;
  location: string | null;
  supplier_id: string | null;
  cost: number;
  min: number;
  max: number;
}

export interface FoodInventoryBatchEntry {
  id: string;
  batch_label: string | null;
  qty: number;
  expiry: string | null;
  cost: number;
  received_date: string;
  cost_center_id: string;
}

export interface StockCountLineEntry {
  id: string;
  item_master_id: string;
  item_name: string;
  uom: string;
  book_qty: number;
  counted_qty: number | null;
  unit_cost: number;
}

export interface StockCountDetail {
  id: string;
  date: string;
  status: "Draft" | "Submitted";
  cost_center_id: string | null;
  cost_center: string | null;
  counted_by: string | null;
  notes: string | null;
  lines: StockCountLineEntry[];
}

export interface StockCountSummary {
  id: string;
  date: string;
  status: "Draft" | "Submitted";
  cost_center: string | null;
  item_count: number;
  variance_value: number;
}

export interface StockTransferLine {
  id: string;
  food_inventory_id: string | null;
  ingredient_name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_cost: number;
}

export interface StockTransfer extends TxnStamps {
  id: string;
  code: string;
  date: string;
  from_cost_center_id: string;
  from_cost_center: string;
  to_cost_center_id: string | null;
  to_cost_center: string | null;
  reason: string;
  notes: string | null;
  total: number;
  lines: StockTransferLine[];
}

export interface WeeklyMealPlanEntry {
  id: string;
  day_of_week: string;
  meal_type: "breakfast" | "lunch" | "dinner";
  recipe_id: string | null;
  custom_meal_name: string | null;
}

export interface WeeklyMealPlan {
  id: string;
  code: string | null;
  occasion_type: string;
  week_start_date: string;
  status: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string | null;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  entries: WeeklyMealPlanEntry[];
}

export interface MealLogLine {
  id: string;
  recipe_id: string | null;
  dish: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_cost: number;
}

export interface MealLogEntry extends TxnStamps {
  id: string;
  code: string;
  date: string;
  cost_center_id: string;
  cost_center: string;
  category: string | null;
  notes: string | null;
  total: number;
  lines: MealLogLine[];
}

export interface Supplier {
  id: string;
  name: string;
  category: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  rating: number | null;
  since: string | null;
}

export interface CreditNote {
  id: string;
  supplier_id: string;
  po_id: string | null;
  date: string;
  reason: string;
  amount: number;
  notes: string | null;
}

export interface PurchaseRequestLine {
  id: string;
  item_master_id: string | null;
  item_name: string;
  qty: number;
  unit: string;
  category: string;
  est_unit_price: number;
  est_cost: number;
}

export interface PurchaseRequest {
  id: string;
  code: string;
  status: string;
  urgency: string;
  request_date: string;
  required_delivery_date: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  note: string | null;
  cost_center: string | null;
  lines: PurchaseRequestLine[];
  total_est_cost: number;
  po_codes: string[];
}

export interface PriceHistoryEntry {
  supplier_id: string;
  supplier_name: string;
  date: string;
  unit_price: number;
  po_code: string;
}

export interface PoLine {
  id: string;
  item_master_id: string | null;
  name: string;
  qty: number;
  unit: string;
  price: number;
  last_price: number | null;
  received_qty: number;
}

export interface PurchaseOrder {
  id: string;
  code: string;
  supplier_id: string;
  status: string;
  order_date: string;
  expected_date: string | null;
  total: number;
  payment_status: string;
  created_by: string | null;
  approved_by: string | null;
  source_pr_id: string | null;
  source_pr_code: string | null;
  lines: PoLine[];
}

export interface ItemMasterEntry {
  id: string;
  name: string;
  code: string;
  uom: string;
  last_price: number;
  preferred_supplier_id: string | null;
  active: boolean;
  stock_type: "food" | "general";
  stock_id: string;
  category: string;
  avg_price: number;
  created_at: string;
  created_by_name: string | null;
}

export interface ItemMasterTransaction {
  doc_type: string;
  code: string;
  date: string;
  status: string;
  qty: number;
  unit: string;
  amount: number;
}

export interface UnitOfMeasureEntry {
  id: string;
  label: string;
  base_unit_id: string | null;
  factor_to_base: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  sku: string;
  unit: string;
  stock: number;
  min: number;
  max: number;
  location: string | null;
  supplier_id: string | null;
  last_price: number;
  avg_price: number;
  expiry: string | null;
  batch: string | null;
}

export interface Asset {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  location_id: string | null;
  install_date: string | null;
  warranty_end: string | null;
  last_service: string | null;
  next_service: string | null;
  provider: string | null;
  supplier_id: string | null;
  status: string;
  approval_status: string;
  purchase_cost: number | null;
  assigned_to: string | null;
}

export interface Area {
  id: string;
  name: string;
  category: string;
  checklist: string[];
  last_score: number | null;
  last_inspected: string | null;
  assignee_id: string | null;
  completion: number;
  completion_tasks_done: number;
  completion_tasks_total: number;
}

export interface TaskItem {
  id: string;
  title: string;
  category: string;
  description: string | null;
  assignee_id: string | null;
  location_id: string | null;
  priority: string;
  due_date: string;
  recurrence: string;
  recurrence_interval_days: number | null;
  requires_verification: boolean;
  status: string;
  verified: boolean;
  photos: number;
  checklist: { id: string; text: string; done: boolean; start_time: string | null; end_time: string | null }[];
  comments: { id: string; author_name: string; text: string; at: string }[];
}

export interface Guest {
  id: string;
  name: string;
  arrival: string;
  arrival_time: string | null;
  departure: string;
  departure_time: string | null;
  count: number;
  room: string | null;
  dietary: string | null;
  requests: string | null;
  driver_id: string | null;
  notes: string | null;
}

export interface EventItem {
  id: string;
  name: string;
  type: string;
  date: string;
  time: string | null;
  location: string | null;
  guests_count: number;
  menu: string | null;
  shopping: string | null;
  staff_needed: string[];
  cleaning: string | null;
  maintenance: string | null;
  notes: string | null;
  tasks_generated: boolean;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  supplier: string | null;
  method: string;
  notes: string | null;
}

export interface DocumentItem {
  id: string;
  name: string;
  category: string;
  linked_to: string | null;
  upload_date: string;
  expiry: string | null;
}

export interface Vehicle {
  id: string;
  name: string;
  reg: string;
  driver_id: string | null;
  mileage: number;
  insurance_expiry: string | null;
  reg_expiry: string | null;
  next_service: string | null;
  tyre_status: string | null;
  fuel_type: string | null;
  color: string | null;
}

export interface PmScheduleItem {
  id: string;
  asset_id: string;
  task: string;
  frequency: string;
  due_date: string;
}

export interface ResidenceSettingsInfo {
  id: string;
  name: string;
  location: string | null;
  currency: string;
  timezone: string;
  monthly_budget: number;
  logo_path: string | null;
  address: string | null;
  phone: string | null;
  terms_and_conditions: string | null;
}

export interface MaintenanceRequest {
  id: string;
  issue: string;
  location_id: string | null;
  description: string | null;
  priority: string;
  reported_by: string | null;
  reported_date: string;
  status: string;
  assignee_id: string | null;
  verified: boolean;
}

export interface MenuOption {
  recipe_id: string;
  note: string | null;
  selected: boolean;
  portions?: number | null;
}

export interface ProposedMenu {
  id: string;
  occasion: string;
  occasion_type: string;
  for_date: string;
  category: string;
  notes: string | null;
  status: string;
  created_by_name: string | null;
  options: MenuOption[];
}

export interface MenuPlanEntry {
  id: string;
  meal_type: "breakfast" | "lunch" | "dinner";
  day_of_week: string;
  dish_name: string;
}

export interface CostOfSalesRow {
  id: string;
  period: string;
  cost_center_id: string;
  cost_center: string;
  stock_type: "food" | "general";
  stock_count_id: string | null;
  count_date: string;
  opening_value: number;
  purchases: number;
  transfers_in: number;
  transfers_out: number;
  closing_value: number;
  cost_of_sales: number;
  meals_value: number;
  waste_value: number;
  count_variance: number;
}
