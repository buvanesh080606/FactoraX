import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Factory,
  History,
  LayoutDashboard,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { DesktopShell } from "../../components/DesktopShell";
import { ErrorBanner, KpiCard, LoadingState, Modal, StatusBadge } from "../../components/ui";
import type { BOM, MaterialItem, Product, ProductionRun, Unit } from "../../types/erp";
import { formatDate, formatINR, formatQty, unwrapList } from "../../utils/format";

interface ConsumptionDraft {
  material_type: "RAW" | "PACKAGING";
  raw_material: number | null;
  packaging_material: number | null;
  material_name: string;
  unit_symbol: string;
  bom_unit_symbol?: string;
  unit_mismatch_message?: string;
  planned_qty: string;
  available_stock: string;
  actual_qty: string;
  damaged_qty: string;
}

export default function ProductionPortalPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = location.pathname.split("/")[2] || "dashboard";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dashData, setDashData] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [boms, setBoms] = useState<BOM[]>([]);
  const [rawMats, setRawMats] = useState<MaterialItem[]>([]);
  const [pkgMats, setPkgMats] = useState<MaterialItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [planningRows, setPlanningRows] = useState<any[]>([]);
  const [varianceRows, setVarianceRows] = useState<any[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // Production Run Wizard state
  const [selectedProductId, setSelectedProductId] = useState<number | "">("");
  const [activeBom, setActiveBom] = useState<BOM | null>(null);
  const [batchMultiplier, setBatchMultiplier] = useState("1");
  const [actualGood, setActualGood] = useState("");
  const [wastageQty, setWastageQty] = useState("0");
  const [labourCost, setLabourCost] = useState("1200");
  const [gasPowerCost, setGasPowerCost] = useState("600");
  const [otherCost, setOtherCost] = useState("0");
  const [runNotes, setRunNotes] = useState("");
  const [draftLines, setDraftLines] = useState<ConsumptionDraft[]>([]);
  const [unitWarnings, setUnitWarnings] = useState<string[]>([]);
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [submittingRun, setSubmittingRun] = useState(false);

  // BOM Editor Modal (Create & Edit with Manual Material Name Typing)
  const [bomModalOpen, setBomModalOpen] = useState(false);
  const [editingBomId, setEditingBomId] = useState<number | null>(null);
  const [bomProdId, setBomProdId] = useState<number | "">("");
  const [bomExpectedOut, setBomExpectedOut] = useState("200");
  const [bomNotes, setBomNotes] = useState("");
  const [bomNotice, setBomNotice] = useState<string | null>(null);
  const [bomLines, setBomLines] = useState<
    Array<{
      material_type: "RAW" | "PACKAGING";
      material_name: string;
      standard_qty: string;
      unit: string;
    }>
  >([]);

  // Run Detail & Edit Modals
  const [detailRun, setDetailRun] = useState<ProductionRun | null>(null);
  const [editingRun, setEditingRun] = useState<ProductionRun | null>(null);
  const [editRunForm, setEditRunForm] = useState({
    run_date: "",
    actual_good_output_qty: "",
    wastage_qty: "0",
    labour_cost: "0",
    gas_power_cost: "0",
    other_overhead_cost: "0",
    notes: "",
  });
  const [savingRunEdit, setSavingRunEdit] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dRes, pRes, bRes, rRes, pkRes, uRes, runRes, varRes, planRes] = await Promise.all([
        api.get("/reports/dashboard/production/"),
        api.get("/masters/products/", { params: { page_size: 100 } }),
        api.get("/masters/boms/", { params: { page_size: 100 } }),
        api.get("/masters/raw-materials/", { params: { page_size: 100 } }),
        api.get("/masters/packaging-materials/", { params: { page_size: 100 } }),
        api.get("/masters/units/"),
        api.get("/production/runs/", { params: { page_size: 50 } }),
        api.get("/production/variance-report/", { params: { flagged_only: flaggedOnly } }),
        api.get("/production/planning/"),
      ]);
      setDashData(dRes.data);
      const pList = unwrapList<Product>(pRes.data);
      const bList = unwrapList<BOM>(bRes.data);
      setProducts(pList);
      setBoms(bList);
      setRawMats(unwrapList<MaterialItem>(rRes.data));
      setPkgMats(unwrapList<MaterialItem>(pkRes.data));
      setUnits(unwrapList<Unit>(uRes.data));
      setRuns(unwrapList<ProductionRun>(runRes.data));
      setVarianceRows(varRes.data.results || []);
      setPlanningRows(planRes.data.results || []);
      if (!selectedProductId && pList.length > 0) {
        setSelectedProductId(pList[0].id);
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [flaggedOnly, selectedProductId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Retrieve active BOM and calculate planned quantities when product or batch changes
  const fetchBomCalculation = useCallback(
    async (prodId: number, multiplier: string) => {
      const bom = boms.find((b) => b.product === prodId && b.is_active) || null;
      setActiveBom(bom);
      setPreviewResult(null);
      if (!bom) {
        setDraftLines([]);
        setUnitWarnings([]);
        return;
      }
      try {
        setError(null);
        const res = await api.get(`/masters/boms/${bom.id}/calculate/`, {
          params: { batch_multiplier: multiplier || "1" },
        });
        setUnitWarnings(Array.isArray(res.data.unit_warnings) ? res.data.unit_warnings : []);
        setActualGood(String(Number(res.data.expected_output_qty)));
        setDraftLines(
          res.data.materials.map((m: any) => ({
            material_type: m.material_type,
            raw_material: m.raw_material,
            packaging_material: m.packaging_material,
            material_name: m.material_name,
            unit_symbol: m.unit_symbol,
            bom_unit_symbol: m.bom_unit_symbol,
            unit_mismatch_message: m.unit_mismatch_message || "",
            planned_qty: m.planned_qty,
            available_stock: m.available_stock,
            actual_qty: m.planned_qty,
            damaged_qty: "0",
          }))
        );
      } catch (err) {
        setDraftLines([]);
        setUnitWarnings([]);
        setError(extractErrorMessage(err));
      }
    },
    [boms]
  );

  useEffect(() => {
    if (section === "run" && selectedProductId && boms.length > 0) {
      fetchBomCalculation(Number(selectedProductId), batchMultiplier);
    }
  }, [section, selectedProductId, batchMultiplier, boms, fetchBomCalculation]);

  const buildRunPayload = () => ({
    product: Number(selectedProductId),
    bom: activeBom?.id,
    batch_multiplier: batchMultiplier,
    actual_good_output_qty: actualGood,
    wastage_qty: wastageQty || "0",
    labour_cost: labourCost || "0",
    gas_power_cost: gasPowerCost || "0",
    other_overhead_cost: otherCost || "0",
    notes: runNotes,
    consumptions: draftLines.map((l) => ({
      material_type: l.material_type,
      raw_material: l.raw_material,
      packaging_material: l.packaging_material,
      actual_qty: l.actual_qty || "0",
      damaged_qty: l.damaged_qty || "0",
    })),
  });

  const handlePreviewRun = async () => {
    setError(null);
    try {
      const res = await api.post("/production/runs/preview/", buildRunPayload());
      setPreviewResult(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleConfirmRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRun(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post("/production/runs/", buildRunPayload());
      setSuccess(
        `Confirmed ${res.data.run_number}: +${formatQty(res.data.actual_good_output_qty)} good packets added to finished stock (Cost/pkt: ${formatINR(res.data.cost_per_good_packet)}).`
      );
      setPreviewResult(null);
      await loadAll();
      navigate("/production/history");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmittingRun(false);
    }
  };

  const openEditRunModal = (r: ProductionRun) => {
    setEditingRun(r);
    setEditRunForm({
      run_date: r.run_date || "",
      actual_good_output_qty: String(Number(r.actual_good_output_qty)),
      wastage_qty: String(Number(r.wastage_qty || 0)),
      labour_cost: String(Number(r.labour_cost || 0)),
      gas_power_cost: String(Number(r.gas_power_cost || 0)),
      other_overhead_cost: String(Number(r.other_overhead_cost || 0)),
      notes: r.notes || "",
    });
  };

  const handleSaveRunEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRun) return;
    setSavingRunEdit(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.patch(`/production/runs/${editingRun.id}/`, editRunForm);
      setSuccess(
        `Updated ${res.data.run_number}: Good output ${formatQty(res.data.actual_good_output_qty)} pkts, Cost/pkt ${formatINR(res.data.cost_per_good_packet)}.`
      );
      setEditingRun(null);
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSavingRunEdit(false);
    }
  };

  const handleRemoveRun = async (r: ProductionRun) => {
    if (
      !window.confirm(
        `Remove production run ${r.run_number} (${r.product_name})?\nThis will automatically reverse its finished stock and restore raw/packaging materials in PostgreSQL.`
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const res = await api.delete(`/production/runs/${r.id}/`);
      setSuccess(res.data?.detail || `Removed ${r.run_number} and reversed stock.`);
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const getUnitRootId = useCallback(
    (uid: number): number => {
      let cur = units.find((u) => u.id === uid);
      let guard = 0;
      while (cur?.base_unit && guard < 10) {
        const next = units.find((u) => u.id === cur!.base_unit);
        if (!next) break;
        cur = next;
        guard += 1;
      }
      return cur ? cur.id : uid;
    },
    [units]
  );

  const getUnitMismatchInfo = useCallback(
    (materialType: "RAW" | "PACKAGING", materialName: string, unitIdStr: string) => {
      const clean = materialName.trim().toLowerCase();
      if (!clean) return null;
      const list = materialType === "RAW" ? rawMats : pkgMats;
      const matched = list.find((m) => m.name.toLowerCase() === clean);
      if (!matched) return null;
      const chosenId = Number(unitIdStr);
      if (!chosenId) return null;
      const matRoot = getUnitRootId(matched.unit);
      const chosenRoot = getUnitRootId(chosenId);
      if (matRoot === chosenRoot) return null;
      const chosenSymbol = units.find((u) => u.id === chosenId)?.symbol || "selected unit";
      const compatSymbols = units
        .filter((u) => getUnitRootId(u.id) === matRoot)
        .map((u) => u.symbol);
      return {
        materialName: matched.name,
        stockUnitId: matched.unit,
        stockUnitSymbol: matched.unit_symbol,
        chosenUnitSymbol: chosenSymbol,
        compatibleSymbols: compatSymbols.length > 0 ? compatSymbols : [matched.unit_symbol],
        message: `"${matched.name}" is tracked in ${matched.unit_symbol} in Inventory (cannot convert ${chosenSymbol} to ${matched.unit_symbol}). Please switch its unit to ${
          compatSymbols.length > 1 ? compatSymbols.join(" or ") : matched.unit_symbol
        }.`,
      };
    },
    [rawMats, pkgMats, units, getUnitRootId]
  );

  const handleSaveBom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBomNotice(null);
    try {
      if (bomLines.length === 0) {
        setBomNotice("Please add at least one recipe material before saving.");
        return;
      }

      for (const l of bomLines) {
        const mismatch = getUnitMismatchInfo(l.material_type, l.material_name, l.unit);
        if (mismatch) {
          setBomNotice(mismatch.message);
          return;
        }
      }

      const resolvedItems = [];
      const rawCache = [...rawMats];
      const pkgCache = [...pkgMats];

      for (const l of bomLines) {
        const cleanName = l.material_name.trim();
        if (!cleanName) {
          setError("Please type a material name for every recipe row.");
          return;
        }
        const unitId = Number(l.unit);
        if (l.material_type === "RAW") {
          let mat = rawCache.find((m) => m.name.toLowerCase() === cleanName.toLowerCase());
          if (!mat) {
            const code = `RM-${cleanName.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "MAT"}-${Math.floor(100 + Math.random() * 900)}`;
            const created = await api.post("/masters/raw-materials/", {
              code,
              name: cleanName,
              unit: unitId,
              reorder_level: "10.000",
            });
            mat = created.data;
            if (mat) rawCache.push(mat);
          }
          resolvedItems.push({
            material_type: "RAW",
            raw_material: mat!.id,
            packaging_material: null,
            standard_qty: l.standard_qty,
            unit: unitId,
          });
        } else {
          let mat = pkgCache.find((m) => m.name.toLowerCase() === cleanName.toLowerCase());
          if (!mat) {
            const code = `PKG-${cleanName.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "MAT"}-${Math.floor(100 + Math.random() * 900)}`;
            const created = await api.post("/masters/packaging-materials/", {
              code,
              name: cleanName,
              unit: unitId,
              reorder_level: "50.000",
            });
            mat = created.data;
            if (mat) pkgCache.push(mat);
          }
          resolvedItems.push({
            material_type: "PACKAGING",
            raw_material: null,
            packaging_material: mat!.id,
            standard_qty: l.standard_qty,
            unit: unitId,
          });
        }
      }

      const payload = {
        product: Number(bomProdId),
        expected_output_qty: bomExpectedOut,
        is_active: true,
        notes: bomNotes,
        items: resolvedItems,
      };

      if (editingBomId) {
        await api.patch(`/masters/boms/${editingBomId}/`, payload);
        setSuccess("BOM updated cleanly in PostgreSQL.");
      } else {
        await api.post("/masters/boms/", payload);
        setSuccess("New active BOM saved in PostgreSQL.");
      }
      setBomModalOpen(false);
      setEditingBomId(null);
      setBomNotice(null);
      loadAll();
    } catch (err) {
      const msg = extractErrorMessage(err);
      if (msg.toLowerCase().includes("unit") || msg.toLowerCase().includes("incompatible")) {
        setBomNotice(msg);
      } else {
        setError(msg);
      }
    }
  };

  const navItems = [
    { to: "/production/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { to: "/production/boms", label: "BOM Master & Editor", icon: <ClipboardList className="h-4 w-4" /> },
    { to: "/production/run", label: "New Production Run", icon: <Factory className="h-4 w-4" /> },
    { to: "/production/variance", label: "Variance Reports", icon: <SlidersHorizontal className="h-4 w-4" /> },
    { to: "/production/history", label: "Production History", icon: <History className="h-4 w-4" /> },
  ];

  return (
    <DesktopShell roleTitle="Production & BOM Control" navItems={navItems}>
      {success && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={loadAll} />
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading factory production data..." />
      ) : (
        <>
          {/* DASHBOARD */}
          {section === "dashboard" && dashData && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                    Production Dashboard
                  </h1>
                  <p className="text-sm text-sf-muted">
                    BOM-driven manufacturing, consumption variance (&gt;3% alerts) &amp; batch costing
                  </p>
                </div>
                <button
                  onClick={() => navigate("/production/run")}
                  className="sf-btn-primary text-xs"
                >
                  <Plus className="h-4 w-4" /> Start Production Run
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Total Production Runs"
                  value={dashData.kpis.total_runs}
                  icon={<Factory className="h-5 w-5" />}
                  tone="purple"
                />
                <KpiCard
                  label="Good Output Produced"
                  value={`${formatQty(dashData.kpis.total_good_output)} pkts`}
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  tone="success"
                />
                <KpiCard
                  label="Flagged Variance Runs"
                  value={dashData.kpis.flagged_variance_runs}
                  subtext={`Avg Yield Var: ${dashData.kpis.avg_yield_variance_pct}%`}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone={dashData.kpis.flagged_variance_runs > 0 ? "danger" : "success"}
                />
                <KpiCard
                  label="Latest Cost / Good Packet"
                  value={formatINR(dashData.kpis.latest_cost_per_packet)}
                  subtext={`${dashData.kpis.low_material_alerts} low material alert(s)`}
                  icon={<SlidersHorizontal className="h-5 w-5" />}
                  tone="magenta"
                />
              </div>

              {/* Production Planning from Pending Orders (PDF Sec 6 Stretch Goal) */}
              {planningRows.length > 0 && (
                <div className="sf-card overflow-hidden border-brand-magenta/30">
                  <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/70 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-sm font-extrabold text-brand-purple">
                        Production Planning from Pending Orders
                      </h3>
                      <p className="text-[11px] text-sf-muted">
                        Automatic batch recommendations based on pending order demand vs live finished stock
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-brand-magenta">
                      Unit Conversions Active: 1 kg = 1,000 g · 1 L = 1,000 ml · 1 carton = 20 pkts
                    </span>
                  </div>
                  <div className="divide-y divide-sf-border">
                    {planningRows.map((pl) => (
                      <div key={pl.product_id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-bold text-brand-purple">{pl.product_name}</p>
                          <p className="text-sf-muted">
                            Pending Demand: <strong>{formatQty(pl.pending_order_qty)} {pl.unit_symbol}</strong> ·
                            Available: <strong>{formatQty(pl.available_stock)} {pl.unit_symbol}</strong> ·
                            Shortage: <strong className="text-sf-danger">{formatQty(pl.shortage_qty)} {pl.unit_symbol}</strong>
                          </p>
                          <p className="mt-0.5 font-semibold text-brand-magenta">{pl.recommendation}</p>
                        </div>
                        {pl.recommended_batches > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductId(pl.product_id);
                              setBatchMultiplier(String(pl.recommended_batches));
                              navigate("/production/run");
                            }}
                            className="sf-btn-primary py-1.5 text-xs"
                          >
                            Start {pl.recommended_batches} Batch(es)
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="sf-card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                    Recent Production Batches
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                        <tr>
                          <th className="px-4 py-2.5 font-bold">Run No</th>
                          <th className="px-4 py-2.5 font-bold">Product</th>
                          <th className="px-4 py-2.5 font-bold">Good / Exp</th>
                          <th className="px-4 py-2.5 font-bold">Yield Var</th>
                          <th className="px-4 py-2.5 font-bold">Cost/Pkt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sf-border">
                        {dashData.recent_runs.map((r: any) => (
                          <tr key={r.id}>
                            <td className="px-4 py-2.5 font-bold text-brand-purple">{r.run_number}</td>
                            <td className="px-4 py-2.5">{r.product_name}</td>
                            <td className="px-4 py-2.5">
                              {formatQty(r.actual_good_output_qty)} / {formatQty(r.expected_output_qty)}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge
                                status={r.has_variance_flag ? "FLAGGED" : "OK"}
                                label={`${r.yield_variance_pct}%`}
                              />
                            </td>
                            <td className="px-4 py-2.5 font-bold">{formatINR(r.cost_per_good_packet)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="sf-card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                    Raw & Packaging Low Stock Alerts
                  </div>
                  <div className="p-4 space-y-2">
                    {dashData.material_alerts.length === 0 ? (
                      <p className="text-xs text-sf-muted">All raw and packaging stocks are healthy.</p>
                    ) : (
                      dashData.material_alerts.map((m: any) => (
                        <div
                          key={`${m.item_type}-${m.code}`}
                          className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs"
                        >
                          <div>
                            <p className="font-bold text-sf-text">{m.name}</p>
                            <p className="text-sf-muted">
                              {m.item_type} · Reorder: {formatQty(m.reorder_level)} {m.unit_symbol}
                            </p>
                          </div>
                          <span className="font-extrabold text-amber-800">
                            {formatQty(m.closing_stock)} {m.unit_symbol}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* BOM MASTER & EDITOR */}
          {section === "boms" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                    Bill of Materials (BOM) Master
                  </h1>
                  <p className="text-sm text-sf-muted">
                    Database-stored standard recipes for finished products
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingBomId(null);
                    setBomProdId(products[0]?.id || "");
                    setBomExpectedOut("200");
                    setBomNotes("");
                    setBomLines([
                      {
                        material_type: "RAW",
                        material_name: "",
                        standard_qty: "10",
                        unit: String(units.find((u) => u.symbol === "kg")?.id || units[0]?.id || ""),
                      },
                    ]);
                    setBomModalOpen(true);
                  }}
                  className="sf-btn-primary text-xs"
                >
                  <Plus className="h-4 w-4" /> Create New BOM
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {boms.map((b) => (
                  <div key={b.id} className="sf-card overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sf-border bg-brand-pink/50 px-4 py-3">
                      <div>
                        <h3 className="font-display text-base font-extrabold text-brand-purple">
                          {b.product_name} ({b.product_pack_size})
                        </h3>
                        <p className="text-xs text-sf-muted">
                          BOM v{b.version} · Expected Output:{" "}
                          <strong>
                            {formatQty(b.expected_output_qty)} {b.product_unit_symbol}
                          </strong>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          status={b.is_active ? "CONFIRMED" : "DRAFT"}
                          label={b.is_active ? "ACTIVE" : "ARCHIVED"}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBomId(b.id);
                            setBomProdId(b.product);
                            setBomExpectedOut(String(Number(b.expected_output_qty)));
                            setBomNotes(b.notes || "");
                            setBomLines(
                              b.items.map((it) => ({
                                material_type: it.material_type,
                                material_name: it.material_name || "",
                                standard_qty: String(Number(it.standard_qty)),
                                unit: String(it.unit),
                              }))
                            );
                            setBomModalOpen(true);
                          }}
                          className="sf-btn-secondary py-1 px-2 text-[11px]"
                          title="Edit BOM"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Remove BOM v${b.version} for "${b.product_name}"?`)) return;
                            try {
                              const res = await api.delete(`/masters/boms/${b.id}/`);
                              setSuccess(res.data?.detail || "BOM removed.");
                              loadAll();
                            } catch (err) {
                              setError(extractErrorMessage(err));
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                          title="Remove BOM"
                        >
                          <Trash2 className="h-3 w-3" /> Remove
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                          <tr>
                            <th className="px-4 py-2 font-bold">Material</th>
                            <th className="px-4 py-2 font-bold">Type</th>
                            <th className="px-4 py-2 font-bold">Std Qty</th>
                            <th className="px-4 py-2 font-bold">Live Stock</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sf-border">
                          {b.items.map((i) => (
                            <tr key={i.id}>
                              <td className="px-4 py-2 font-semibold">{i.material_name}</td>
                              <td className="px-4 py-2 text-sf-muted">{i.material_type}</td>
                              <td className="px-4 py-2 font-bold">
                                {formatQty(i.standard_qty)} {i.unit_symbol}
                              </td>
                              <td className="px-4 py-2">
                                {formatQty(i.available_stock)} {i.unit_symbol}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PRODUCTION RUN CREATION WIZARD */}
          {section === "run" && (
            <form onSubmit={handleConfirmRun} className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                  Execute Atomic Production Run
                </h1>
                <p className="text-sm text-sf-muted">
                  Select product & batch size, enter actual consumption, damaged packaging, output &
                  overheads — stock updates atomically in PostgreSQL.
                </p>
              </div>

              <div className="sf-card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="sf-label">Product</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(Number(e.target.value))}
                    className="sf-input"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.pack_size})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="sf-label">Batch Multiplier</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    value={batchMultiplier}
                    onChange={(e) => setBatchMultiplier(e.target.value)}
                    className="sf-input"
                  />
                </div>
                <div>
                  <label className="sf-label">Actual Good Output (Packets)</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={actualGood}
                    onChange={(e) => setActualGood(e.target.value)}
                    className="sf-input"
                  />
                </div>
                <div>
                  <label className="sf-label">Product Wastage Qty</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={wastageQty}
                    onChange={(e) => setWastageQty(e.target.value)}
                    className="sf-input"
                  />
                </div>
              </div>

              {!activeBom ? (
                <ErrorBanner message="No active BOM found for this product. Create an active BOM first." />
              ) : (
                <>
                  {unitWarnings.length > 0 && (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-bold text-amber-950">
                            Unit Mismatch Notice (Please review before running production)
                          </p>
                          {unitWarnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBomId(activeBom.id);
                          setBomProdId(activeBom.product);
                          setBomExpectedOut(String(Number(activeBom.expected_output_qty)));
                          setBomNotes(activeBom.notes || "");
                          setBomNotice(unitWarnings[0] || null);
                          setBomLines(
                            activeBom.items.map((it) => ({
                              material_type: it.material_type,
                              material_name: it.material_name || "",
                              standard_qty: String(Number(it.standard_qty)),
                              unit: String(it.unit),
                            }))
                          );
                          setBomModalOpen(true);
                        }}
                        className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 shrink-0"
                      >
                        Fix Unit in BOM
                      </button>
                    </div>
                  )}

                  {/* Material Consumption Table */}
                  <div className="sf-card overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/50 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold text-brand-purple">
                        Material Consumption (Active BOM v{activeBom.version})
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-sf-muted">
                          Expected Batch Output:{" "}
                          <strong className="text-brand-purple">
                            {formatQty(Number(activeBom.expected_output_qty) * Number(batchMultiplier || 1))} pkts
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBomId(activeBom.id);
                            setBomProdId(activeBom.product);
                            setBomExpectedOut(String(Number(activeBom.expected_output_qty)));
                            setBomNotes(activeBom.notes || "");
                            setBomNotice(null);
                            setBomLines(
                              activeBom.items.map((it) => ({
                                material_type: it.material_type,
                                material_name: it.material_name || "",
                                standard_qty: String(Number(it.standard_qty)),
                                unit: String(it.unit),
                              }))
                            );
                            setBomModalOpen(true);
                          }}
                          className="sf-btn-secondary py-1 px-2.5 text-[11px]"
                        >
                          <Pencil className="h-3 w-3" /> Edit BOM
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                          <tr>
                            <th className="px-4 py-2.5 font-bold">Material</th>
                            <th className="px-4 py-2.5 font-bold">Planned</th>
                            <th className="px-4 py-2.5 font-bold">Available Stock</th>
                            <th className="px-4 py-2.5 font-bold">Actual Issued</th>
                            <th className="px-4 py-2.5 font-bold">Damaged Qty</th>
                            <th className="px-4 py-2.5 font-bold">Total Deduct</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sf-border">
                          {draftLines.map((line, idx) => {
                            const totalDeduct =
                              (Number(line.actual_qty) || 0) + (Number(line.damaged_qty) || 0);
                            const shortage = totalDeduct > Number(line.available_stock);
                            return (
                              <tr key={idx} className={shortage ? "bg-red-50/70" : ""}>
                                <td className="px-4 py-2.5 font-bold text-brand-purple">
                                  <div>
                                    {line.material_name}{" "}
                                    <span className="text-[10px] font-normal text-sf-muted">
                                      ({line.material_type})
                                    </span>
                                  </div>
                                  {line.unit_mismatch_message && (
                                    <div className="mt-0.5 text-[11px] font-semibold text-amber-700">
                                      BOM unit ({line.bom_unit_symbol}) differs from Inventory unit ({line.unit_symbol})
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  {formatQty(line.planned_qty)} {line.unit_symbol}
                                </td>
                                <td className="px-4 py-2.5 font-semibold">
                                  {formatQty(line.available_stock)} {line.unit_symbol}
                                </td>
                                <td className="px-4 py-2.5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={line.actual_qty}
                                    onChange={(e) =>
                                      setDraftLines((prev) =>
                                        prev.map((r, i) =>
                                          i === idx ? { ...r, actual_qty: e.target.value } : r
                                        )
                                      )
                                    }
                                    className="sf-input py-1.5 w-28"
                                  />
                                </td>
                                <td className="px-4 py-2.5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={line.damaged_qty}
                                    onChange={(e) =>
                                      setDraftLines((prev) =>
                                        prev.map((r, i) =>
                                          i === idx ? { ...r, damaged_qty: e.target.value } : r
                                        )
                                      )
                                    }
                                    className="sf-input py-1.5 w-24"
                                  />
                                </td>
                                <td className="px-4 py-2.5 font-bold">
                                  <span className={shortage ? "text-sf-danger" : "text-sf-text"}>
                                    {formatQty(totalDeduct)} {line.unit_symbol}
                                  </span>
                                  {shortage && (
                                    <span className="block text-[10px] text-sf-danger">
                                      Insufficient stock!
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Overheads & Notes */}
                  <div className="sf-card p-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="sf-label">Labour Cost (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={labourCost}
                        onChange={(e) => setLabourCost(e.target.value)}
                        className="sf-input"
                      />
                    </div>
                    <div>
                      <label className="sf-label">Gas & Electricity (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={gasPowerCost}
                        onChange={(e) => setGasPowerCost(e.target.value)}
                        className="sf-input"
                      />
                    </div>
                    <div>
                      <label className="sf-label">Other Overheads (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={otherCost}
                        onChange={(e) => setOtherCost(e.target.value)}
                        className="sf-input"
                      />
                    </div>
                    <div>
                      <label className="sf-label">Batch Notes</label>
                      <input
                        type="text"
                        value={runNotes}
                        onChange={(e) => setRunNotes(e.target.value)}
                        placeholder="Shift / supervisor note"
                        className="sf-input"
                      />
                    </div>
                  </div>

                  {/* Preview Panel */}
                  {previewResult && (
                    <div className="sf-card p-5 border-2 border-brand-magenta/30 bg-brand-pink/30 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display text-base font-extrabold text-brand-purple">
                          Variance & Costing Preview (Weighted Average)
                        </h3>
                        <StatusBadge
                          status={previewResult.has_variance_flag ? "FLAGGED" : "OK"}
                          label={
                            previewResult.has_variance_flag
                              ? `Variance Exceeds ${previewResult.tolerance_pct}% Tolerance`
                              : "Within Tolerance"
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                        <div className="rounded-xl bg-white p-3 border border-sf-border">
                          <p className="text-sf-muted">Yield Variance</p>
                          <p className="font-display text-base font-extrabold text-brand-purple mt-0.5">
                            {previewResult.yield_variance_pct}%
                          </p>
                        </div>
                        <div className="rounded-xl bg-white p-3 border border-sf-border">
                          <p className="text-sf-muted">Material + Pkg</p>
                          <p className="font-display text-base font-extrabold text-sf-text mt-0.5">
                            {formatINR(
                              Number(previewResult.raw_material_cost) +
                                Number(previewResult.packaging_cost)
                            )}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white p-3 border border-sf-border">
                          <p className="text-sf-muted">Total Cost</p>
                          <p className="font-display text-base font-extrabold text-brand-purple mt-0.5">
                            {formatINR(previewResult.total_production_cost)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white p-3 border border-sf-border">
                          <p className="text-sf-muted">Cost / Good Packet</p>
                          <p className="font-display text-base font-extrabold text-brand-magenta mt-0.5">
                            {formatINR(previewResult.cost_per_good_packet)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white p-3 border border-sf-border">
                          <p className="text-sf-muted">Est. Margin / Pkt</p>
                          <p className="font-display text-base font-extrabold text-sf-success mt-0.5">
                            {formatINR(previewResult.estimated_margin_per_packet)} (
                            {previewResult.estimated_margin_pct}%)
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-3">
                    <button type="button" onClick={handlePreviewRun} className="sf-btn-secondary">
                      Calculate Variance & Cost Preview
                    </button>
                    <button type="submit" disabled={submittingRun} className="sf-btn-primary">
                      {submittingRun
                        ? "Committing Atomic Transaction..."
                        : "Confirm & Commit Production Run"}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}

          {/* VARIANCE REPORTS */}
          {section === "variance" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                    Consumption & Yield Variance Reports
                  </h1>
                  <p className="text-sm text-sf-muted">
                    Flags any consumption or yield deviation exceeding 3% tolerance
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 rounded-xl bg-white border border-sf-border px-3.5 py-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flaggedOnly}
                    onChange={(e) => setFlaggedOnly(e.target.checked)}
                    className="rounded text-brand-magenta"
                  />
                  Show Flagged (&gt;3%) Only
                </label>
              </div>
              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Run No</th>
                      <th className="px-4 py-3 font-bold">Product</th>
                      <th className="px-4 py-3 font-bold">Material</th>
                      <th className="px-4 py-3 font-bold">Planned</th>
                      <th className="px-4 py-3 font-bold">Actual</th>
                      <th className="px-4 py-3 font-bold">Damaged</th>
                      <th className="px-4 py-3 font-bold">Total Issued</th>
                      <th className="px-4 py-3 font-bold">Variance %</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {varianceRows.map((v) => (
                      <tr key={v.id} className={v.is_variance_flagged ? "bg-red-50/40" : ""}>
                        <td className="px-4 py-2.5 font-bold text-brand-purple">{v.run_number}</td>
                        <td className="px-4 py-2.5">{v.product_name}</td>
                        <td className="px-4 py-2.5 font-semibold">{v.material_name}</td>
                        <td className="px-4 py-2.5">
                          {formatQty(v.planned_qty)} {v.unit_symbol}
                        </td>
                        <td className="px-4 py-2.5">
                          {formatQty(v.actual_qty)} {v.unit_symbol}
                        </td>
                        <td className="px-4 py-2.5">
                          {formatQty(v.damaged_qty)} {v.unit_symbol}
                        </td>
                        <td className="px-4 py-2.5 font-bold">
                          {formatQty(v.total_issued_qty)} {v.unit_symbol}
                        </td>
                        <td className="px-4 py-2.5 font-extrabold">{v.variance_pct}%</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge
                            status={v.is_variance_flagged ? "FLAGGED" : "OK"}
                            label={v.is_variance_flagged ? "FLAGGED >3%" : "OK"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PRODUCTION HISTORY */}
          {section === "history" && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                Production History & Batch Costing
              </h1>
              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Run No</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Product</th>
                      <th className="px-4 py-3 font-bold">Expected</th>
                      <th className="px-4 py-3 font-bold">Good Output</th>
                      <th className="px-4 py-3 font-bold">Yield Var</th>
                      <th className="px-4 py-3 font-bold">Total Cost</th>
                      <th className="px-4 py-3 font-bold">Cost / Pkt</th>
                      <th className="px-4 py-3 font-bold">Margin / Pkt</th>
                      <th className="px-4 py-3 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {runs.map((r) => (
                      <tr key={r.id} className="hover:bg-brand-pink/30">
                        <td className="px-4 py-3 font-bold text-brand-purple">{r.run_number}</td>
                        <td className="px-4 py-3">{formatDate(r.run_date)}</td>
                        <td className="px-4 py-3 font-semibold">
                          {r.product_name} ({r.product_pack_size})
                        </td>
                        <td className="px-4 py-3">{formatQty(r.expected_output_qty)}</td>
                        <td className="px-4 py-3 font-bold">{formatQty(r.actual_good_output_qty)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            status={r.has_variance_flag ? "FLAGGED" : "OK"}
                            label={`${r.yield_variance_pct}%`}
                          />
                        </td>
                        <td className="px-4 py-3">{formatINR(r.total_production_cost)}</td>
                        <td className="px-4 py-3 font-bold text-brand-magenta">
                          {formatINR(r.cost_per_good_packet)}
                        </td>
                        <td className="px-4 py-3 font-bold text-sf-success">
                          {formatINR(r.estimated_margin_per_packet)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailRun(r)}
                              className="sf-btn-secondary py-1 px-2 text-[11px]"
                            >
                              Breakdown
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditRunModal(r)}
                              className="sf-btn-secondary py-1 px-2 text-[11px]"
                              title="Edit Production Run"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveRun(r)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                              title="Remove Production Run"
                            >
                              <Trash2 className="h-3 w-3" /> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create / Edit BOM Modal (Manual Material Name Typing) */}
      <Modal
        open={bomModalOpen}
        onClose={() => {
          setBomModalOpen(false);
          setEditingBomId(null);
          setBomNotice(null);
        }}
        title={editingBomId ? "Edit Active BOM" : "Create Active BOM"}
        wide
      >
        <form onSubmit={handleSaveBom} className="space-y-4">
          {bomNotice && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{bomNotice}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="sf-label">Product</label>
              <select
                value={bomProdId}
                onChange={(e) => setBomProdId(Number(e.target.value))}
                className="sf-input"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.pack_size})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="sf-label">Expected Batch Output (Packets)</label>
              <input
                type="number"
                required
                min="1"
                value={bomExpectedOut}
                onChange={(e) => setBomExpectedOut(e.target.value)}
                className="sf-input"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="sf-label mb-0">Recipe Materials (Type Material Name)</label>
              <button
                type="button"
                onClick={() =>
                  setBomLines((prev) => [
                    ...prev,
                    {
                      material_type: "RAW",
                      material_name: "",
                      standard_qty: "1",
                      unit: String(units.find((u) => u.symbol === "kg")?.id || units[0]?.id || ""),
                    },
                  ])
                }
                className="text-xs font-bold text-brand-magenta"
              >
                + Add Material
              </button>
            </div>

            <datalist id="bom-raw-materials">
              {rawMats.map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>
            <datalist id="bom-pkg-materials">
              {pkgMats.map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>

            {bomLines.map((l, idx) => {
              const mismatch = getUnitMismatchInfo(l.material_type, l.material_name, l.unit);
              return (
                <div key={idx} className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={l.material_type}
                      onChange={(e) => {
                        const mt = e.target.value as "RAW" | "PACKAGING";
                        const defaultUnit =
                          mt === "PACKAGING"
                            ? units.find((u) => u.symbol === "pcs")?.id
                            : units.find((u) => u.symbol === "kg")?.id;
                        setBomNotice(null);
                        setBomLines((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  material_type: mt,
                                  unit: String(defaultUnit || row.unit),
                                }
                              : row
                          )
                        );
                      }}
                      className="sf-input col-span-3 py-2 text-xs"
                    >
                      <option value="RAW">Raw</option>
                      <option value="PACKAGING">Packaging</option>
                    </select>
                    <input
                      type="text"
                      required
                      list={l.material_type === "RAW" ? "bom-raw-materials" : "bom-pkg-materials"}
                      placeholder={
                        l.material_type === "RAW"
                          ? "Type raw material name (e.g. Tapioca)"
                          : "Type packaging name (e.g. 200g Pouch)"
                      }
                      value={l.material_name}
                      onChange={(e) => {
                        const typed = e.target.value;
                        const list = l.material_type === "RAW" ? rawMats : pkgMats;
                        const match = list.find(
                          (m) => m.name.toLowerCase() === typed.trim().toLowerCase()
                        );
                        setBomNotice(null);
                        setBomLines((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  material_name: typed,
                                  unit: match ? String(match.unit) : row.unit,
                                }
                              : row
                          )
                        );
                      }}
                      className="sf-input col-span-4 py-2 text-xs"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={l.standard_qty}
                      onChange={(e) =>
                        setBomLines((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, standard_qty: e.target.value } : row))
                        )
                      }
                      className="sf-input col-span-2 py-2 text-xs"
                    />
                    <select
                      value={l.unit}
                      onChange={(e) => {
                        setBomNotice(null);
                        setBomLines((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unit: e.target.value } : row))
                        );
                      }}
                      className={`sf-input col-span-2 py-2 text-xs ${
                        mismatch ? "border-amber-400 bg-amber-50 text-amber-900" : ""
                      }`}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.symbol}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBomLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 text-sf-danger flex justify-center"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {mismatch && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
                      <span>{mismatch.message}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setBomNotice(null);
                          setBomLines((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, unit: String(mismatch.stockUnitId) } : row
                            )
                          );
                        }}
                        className="rounded-md bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold text-amber-950 hover:bg-amber-300"
                      >
                        Use {mismatch.stockUnitSymbol}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-sf-muted">
              Tip: Type an existing material name or any new ingredient — new materials are automatically registered in PostgreSQL when saved.
            </p>
          </div>

          <div>
            <label className="sf-label">Notes</label>
            <input
              type="text"
              value={bomNotes}
              onChange={(e) => setBomNotes(e.target.value)}
              className="sf-input"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setBomModalOpen(false);
                setEditingBomId(null);
              }}
              className="sf-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="sf-btn-primary">
              {editingBomId ? "Update Active BOM" : "Save Active BOM"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Run Detail Breakdown Modal */}
      <Modal
        open={Boolean(detailRun)}
        onClose={() => setDetailRun(null)}
        title={detailRun ? `Cost & Consumption Breakdown — ${detailRun.run_number}` : "Details"}
        wide
      >
        {detailRun && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-brand-pink/60 p-3">
                <p className="text-sf-muted">Raw Materials</p>
                <p className="font-bold text-sm text-brand-purple">{formatINR(detailRun.raw_material_cost)}</p>
              </div>
              <div className="rounded-xl bg-brand-pink/60 p-3">
                <p className="text-sf-muted">Packaging</p>
                <p className="font-bold text-sm text-brand-purple">{formatINR(detailRun.packaging_cost)}</p>
              </div>
              <div className="rounded-xl bg-brand-pink/60 p-3">
                <p className="text-sf-muted">Overheads (Lab+Gas)</p>
                <p className="font-bold text-sm text-brand-purple">
                  {formatINR(
                    Number(detailRun.labour_cost) +
                      Number(detailRun.gas_power_cost) +
                      Number(detailRun.other_overhead_cost)
                  )}
                </p>
              </div>
              <div className="rounded-xl bg-brand-purple text-white p-3">
                <p className="text-pink-200">Cost / Good Packet</p>
                <p className="font-bold text-sm">{formatINR(detailRun.cost_per_good_packet)}</p>
              </div>
            </div>
            <div className="overflow-x-auto border border-sf-border rounded-xl">
              <table className="min-w-full text-left">
                <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                  <tr>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Planned</th>
                    <th className="px-3 py-2">Actual</th>
                    <th className="px-3 py-2">Damaged</th>
                    <th className="px-3 py-2">Var %</th>
                    <th className="px-3 py-2">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sf-border">
                  {detailRun.consumptions.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-semibold">{c.material_name}</td>
                      <td className="px-3 py-2">
                        {formatQty(c.planned_qty)} {c.unit_symbol}
                      </td>
                      <td className="px-3 py-2">
                        {formatQty(c.actual_qty)} {c.unit_symbol}
                      </td>
                      <td className="px-3 py-2">
                        {formatQty(c.damaged_qty)} {c.unit_symbol}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          status={c.is_variance_flagged ? "FLAGGED" : "OK"}
                          label={`${c.variance_pct}%`}
                        />
                      </td>
                      <td className="px-3 py-2 font-bold">{formatINR(c.total_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Production Run Modal */}
      <Modal
        open={Boolean(editingRun)}
        onClose={() => setEditingRun(null)}
        title={editingRun ? `Edit Production Run — ${editingRun.run_number}` : "Edit Production Run"}
        wide
      >
        {editingRun && (
          <form onSubmit={handleSaveRunEdit} className="space-y-4">
            <div className="rounded-xl border border-sf-border bg-brand-pink/40 p-3 text-xs text-brand-purple">
              <strong>{editingRun.product_name} ({editingRun.product_pack_size})</strong> · Expected Output:{" "}
              <strong>{formatQty(editingRun.expected_output_qty)} pkts</strong>. Changing Actual Good Output
              automatically posts an audit-safe adjustment in the Stock Ledger and recalculates Cost/Packet.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="sf-label">Run Date</label>
                <input
                  type="date"
                  required
                  value={editRunForm.run_date}
                  onChange={(e) => setEditRunForm((f) => ({ ...f, run_date: e.target.value }))}
                  className="sf-input"
                />
              </div>
              <div>
                <label className="sf-label">Actual Good Output (Packets)</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  required
                  value={editRunForm.actual_good_output_qty}
                  onChange={(e) =>
                    setEditRunForm((f) => ({ ...f, actual_good_output_qty: e.target.value }))
                  }
                  className="sf-input"
                />
              </div>
              <div>
                <label className="sf-label">Product Wastage Qty</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editRunForm.wastage_qty}
                  onChange={(e) => setEditRunForm((f) => ({ ...f, wastage_qty: e.target.value }))}
                  className="sf-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="sf-label">Labour Cost (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editRunForm.labour_cost}
                  onChange={(e) => setEditRunForm((f) => ({ ...f, labour_cost: e.target.value }))}
                  className="sf-input"
                />
              </div>
              <div>
                <label className="sf-label">Gas & Electricity (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editRunForm.gas_power_cost}
                  onChange={(e) =>
                    setEditRunForm((f) => ({ ...f, gas_power_cost: e.target.value }))
                  }
                  className="sf-input"
                />
              </div>
              <div>
                <label className="sf-label">Other Overheads (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editRunForm.other_overhead_cost}
                  onChange={(e) =>
                    setEditRunForm((f) => ({ ...f, other_overhead_cost: e.target.value }))
                  }
                  className="sf-input"
                />
              </div>
            </div>
            <div>
              <label className="sf-label">Batch Notes</label>
              <input
                type="text"
                value={editRunForm.notes}
                onChange={(e) => setEditRunForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Shift / supervisor note"
                className="sf-input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingRun(null)}
                className="sf-btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={savingRunEdit} className="sf-btn-primary">
                {savingRunEdit ? "Saving..." : "Update Production Run"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </DesktopShell>
  );
}
