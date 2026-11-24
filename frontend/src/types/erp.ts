export type UserRole =
  | "SALESMAN"
  | "ADMIN"
  | "PRODUCTION"
  | "ACCOUNTANT"
  | "OWNER";

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: UserRole;
  phone: string;
  territory: string;
  is_active: boolean;
  home_route: string;
}

export interface CompanySetting {
  id: number;
  company_name: string;
  gstin: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  invoice_prefix: string;
  financial_year: string;
  variance_tolerance_pct: string;
  default_gst_rate: string;
}

export interface Unit {
  id: number;
  name: string;
  symbol: string;
  base_unit?: number | null;
  base_unit_symbol?: string | null;
  factor_to_base?: string;
}

export interface Customer {
  id: number;
  code: string;
  name: string;
  customer_type: "RETAILER" | "DISTRIBUTOR" | "WHOLESALER" | "SUPERMARKET";
  state: string;
  gstin: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  credit_limit: string;
  assigned_salesman: number | null;
  assigned_salesman_name: string | null;
  outstanding_balance: string;
  is_active: boolean;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  gstin: string;
  state: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  is_active: boolean;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: "MURUKKU" | "MIXTURE" | "CHIPS" | "SWEETS";
  pack_size: string;
  unit: number;
  unit_symbol: string;
  hsn_code: string;
  gst_rate: string;
  selling_price: string;
  reorder_level: string;
  image_url: string;
  description: string;
  available_stock: string;
  stock_status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  active_bom_id: number | null;
  is_active: boolean;
}

export interface MaterialItem {
  id: number;
  code: string;
  name: string;
  unit: number;
  unit_symbol: string;
  reorder_level: string;
  weighted_avg_cost: string;
  available_stock: string;
  stock_status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  is_active: boolean;
}

export interface BOMItem {
  id?: number;
  material_type: "RAW" | "PACKAGING";
  raw_material: number | null;
  packaging_material: number | null;
  material_name?: string;
  standard_qty: string;
  unit: number;
  unit_symbol?: string;
  available_stock?: string;
  weighted_avg_cost?: string;
}

export interface BOM {
  id: number;
  product: number;
  product_name: string;
  product_pack_size: string;
  product_unit_symbol: string;
  version: number;
  expected_output_qty: string;
  is_active: boolean;
  notes: string;
  items: BOMItem[];
}

export interface InventorySummaryRow {
  item_type: "RAW" | "PACKAGING" | "FINISHED";
  item_id: number;
  code: string;
  name: string;
  unit_symbol: string;
  opening_stock: string;
  receipts: string;
  issues: string;
  adjustments: string;
  closing_stock: string;
  reorder_level: string;
  unit_cost: string;
  stock_value: string;
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
}

export interface StockLedgerEntry {
  id: number;
  item_type: string;
  item_name: string;
  unit_symbol: string;
  movement_type: string;
  quantity_delta: string;
  unit_cost: string;
  total_value: string;
  running_balance: string;
  source_type: string;
  source_id: string;
  reference_no: string;
  notes: string;
  created_by_name: string;
  created_at: string;
}

export interface SalesOrderItem {
  id: number;
  product: number;
  product_name: string;
  pack_size: string;
  unit_symbol: string;
  quantity: string;
  unit_price: string;
  gst_rate: string;
  taxable_amount: string;
  gst_amount: string;
  line_total: string;
}

export interface SalesOrder {
  id: number;
  order_number: string;
  customer: number;
  customer_name: string;
  customer_state: string;
  customer_type: string;
  salesman: number;
  salesman_name: string;
  order_date: string;
  status:
    | "SUBMITTED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "INVOICED"
    | "DISPATCHED"
    | "REJECTED";
  subtotal: string;
  tax_estimate: string;
  grand_total: string;
  total_quantity: string;
  stock_sufficient: boolean;
  delivery_notes: string;
  rejection_reason: string;
  approved_by_name: string | null;
  approved_at: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  items: SalesOrderItem[];
  status_history: Array<{
    id: number;
    from_status: string;
    to_status: string;
    changed_by_name: string;
    remarks: string;
    created_at: string;
  }>;
  created_at: string;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  financial_year: string;
  invoice_date: string;
  order: number;
  order_number: string;
  order_status: string;
  customer: number;
  customer_phone?: string;
  customer_email?: string;
  seller_name: string;
  seller_gstin: string;
  seller_state: string;
  customer_name: string;
  customer_gstin: string;
  customer_state: string;
  customer_address: string;
  is_inter_state: boolean;
  taxable_total: string;
  cgst_total: string;
  sgst_total: string;
  igst_total: string;
  grand_total: string;
  credit_notes_total?: string;
  credit_notes?: Array<{
    id: number;
    credit_note_number: string;
    credit_date: string;
    amount: string;
    reason: string;
    restock_finished_goods: boolean;
    created_by_name: string | null;
  }>;
  allocated_payments: string;
  outstanding_amount: string;
  dispatch_status: "PENDING" | "PARTIAL" | "DISPATCHED";
  items: Array<{
    id: number;
    product: number;
    product_name: string;
    hsn_code: string;
    quantity: string;
    unit_price: string;
    taxable_amount: string;
    gst_rate: string;
    cgst_amount: string;
    sgst_amount: string;
    igst_amount: string;
    line_total: string;
    dispatched_qty: string;
    remaining_qty: string;
  }>;
}

export interface ProductionRun {
  id: number;
  run_number: string;
  product: number;
  product_name: string;
  product_pack_size: string;
  product_selling_price: string;
  bom: number;
  bom_version: number;
  run_date: string;
  batch_multiplier: string;
  expected_output_qty: string;
  actual_good_output_qty: string;
  wastage_qty: string;
  damaged_packaging_qty: string;
  yield_variance_pct: string;
  has_variance_flag: boolean;
  raw_material_cost: string;
  packaging_cost: string;
  labour_cost: string;
  gas_power_cost: string;
  other_overhead_cost: string;
  total_production_cost: string;
  cost_per_good_packet: string;
  estimated_margin_per_packet: string;
  status: string;
  notes: string;
  supervised_by_name: string | null;
  confirmed_at: string;
  consumptions: Array<{
    id: number;
    material_type: string;
    raw_material: number | null;
    packaging_material: number | null;
    material_name: string;
    unit_symbol: string;
    planned_qty: string;
    actual_qty: string;
    damaged_qty: string;
    total_issued_qty: string;
    variance_qty: string;
    variance_pct: string;
    is_variance_flagged: boolean;
    unit_cost: string;
    total_cost: string;
  }>;
}

export interface NotificationItem {
  id: number;
  event_type: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  is_read: boolean;
  created_at: string;
}
