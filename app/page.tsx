"use client";

// app/page.tsx — OPD Reimbursements (Dubizzle Labs HR)
// Live from the published Google Sheet. Red + grey only. Sidebar + 3 tabs,
// Dept/Month/Batch/Status filters, forecast, drill-down (with its own filter
// and extra stats). No pivot. No charting library needed.

import { useEffect, useMemo, useState, type CSSProperties } from "react";

/* Your sheet's "Publish to web -> CSV" link. This is the live data source. */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTpoPoKZu30PSa4aKLSfB039K8CAWtebdMXDL3uYoC-p7zVJ1iB8lnG-Yf6b02fviSg_vZOMVLSqyDT/pub?gid=491866189&single=true&output=csv";

/* Login accounts — a simple front-end gate. Add/remove people or change passwords
   here, then push to redeploy. NOTE: this is NOT real security — these credentials
   ship inside the page and the sheet data is public. For real protection use the
   Apps Script login step (see chat notes). */
const USERS: Record<string, string> = {
  "hasnain.pirzada@dubizzlelabs.com": "12345",
  "zain.ghori@dubizzlelabs.com": "12345",
  "hr@dubizzlelabs.com": "12345",
};
function getPassword(email: string) {
  try { const o = JSON.parse(localStorage.getItem("opd_pw") || "{}"); if (o[email]) return o[email] as string; } catch {}
  return USERS[email];
}
function setStoredPassword(email: string, pw: string) {
  try { const o = JSON.parse(localStorage.getItem("opd_pw") || "{}"); o[email] = pw; localStorage.setItem("opd_pw", JSON.stringify(o)); } catch {}
}


/* ---- palette: red + grey only ---- */
const FLAME = "#E00000", BRICK = "#B51414", INK = "#1C1D1E", GREASE = "#2B2D2E";
const CHARCOAL = "#5A5C5E", SMOKE = "#9AA0A6", CLOUD = "#EAECEF", PAGE = "#F6F7F8", TRACK = "#F0F1F3";
function mix(a: string, b: string, t: number) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const redShade = (v: number, max: number) => mix("#CDD2D7", BRICK, max ? v / max : 0);
const MONLBL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const STATUS_COLORS: Record<string, string> = { "Payment Cleared": FLAME, "Payment Under Process": SMOKE };

type Row = {
  ticket: string; empId: string; email: string; dept: string;
  requested: number; payable: number; trim: number; status: string;
  batch: string; paydate: string; dateObj: Date | null; paid: boolean;
  monthKey: string; monthLbl: string;
};

/* tiny placeholder (no real people) — only used if the live sheet can't be reached */
const SAMPLE = `Ticket ID,Employee ID,Email,Department,Ticket Created Date,Amount Requested,Amount Payable,Final Status By HR,Batch No,Payment Date
1001,E001,person.one@example.com,PK(N/C) - Dubizzle Labs - Bayut,"Feb 2, 2026",12000,12000,Payment Cleared,2,13-Feb-2026
1002,E002,person.two@example.com,PK(N/C) - Dubizzle Labs - Mobile Apps,"Mar 5, 2026",8000,6500,Payment Cleared,7,19-Mar-2026
1003,E003,person.three@example.com,PK(N/C) - Dubizzle Labs - Legion BE,"Apr 9, 2026",15000,15000,Payment Cleared,10,08-Apr-2026
1004,E004,person.four@example.com,PK(N/C) - Dubizzle Labs - Propforce,"May 4, 2026",5000,4200,Payment Cleared,15,16-May-2026
1005,E005,person.five@example.com,PK(N/C) - Dubizzle Labs - Jarvis FE,"Jun 3, 2026",20000,18000,Payment Cleared,18,10-June-2026
1006,E006,person.six@example.com,PK(N/C) - Dubizzle Labs - Strat,"Jul 7, 2026",9000,9000,Payment Cleared,20,14-Jul-2026
1007,E007,person.seven@example.com,PK(N/C) - Dubizzle Labs - Bayut,"Aug 8, 2026",30000,26000,Payment Cleared,24,19-Aug-2026
1008,E008,person.eight@example.com,PK(N/C) - Dubizzle Labs - Data Engineering,"Sep 2, 2026",11000,11000,Payment Under Process,29,
1009,E009,person.nine@example.com,PK(N/C) - Dubizzle Labs - Mobile Apps,"Oct 1, 2026",7000,7000,Payment Under Process,31,
1010,E010,person.ten@example.com,PK(N/C) - Dubizzle Labs - HR,"Aug 18, 2026",4000,4000,Payment Cleared,25,28-Aug-2026`;

/* ---- helpers ---- */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let field = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function num(x: unknown) { if (x == null) return 0; const n = parseFloat(String(x).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
function pkr(n: number) { return "PKR " + Math.round(n).toLocaleString("en-US"); }
function short(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return "PKR " + (n / 1_000_000).toFixed(2) + "M";
  if (a >= 1_000) return "PKR " + Math.round(n / 1_000) + "k";
  return "PKR " + Math.round(n);
}
function parseDate(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (m) { const mi = MON[m[2].slice(0, 3).toLowerCase()]; if (mi != null) return new Date(+m[3], mi, +m[1]); }
  const d = new Date(s); return isNaN(+d) ? null : d;
}
function cleanDept(s: string) {
  if (!s) return "—";
  return s.replace(/^PK\([^)]*\)\s*-\s*/, "").replace(/^Dubizzle Labs\s*-\s*/i, "").trim() || "—";
}
function empName(email: string) {
  if (!email) return "—";
  return email.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function toRows(text: string): Row[] {
  const grid = parseCSV(text);
  if (!grid.length) return [];
  const head = grid[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => head.indexOf(name);
  const iTicket = idx("ticket id"), iEmp = idx("employee id"), iEmail = idx("email"),
    iDept = idx("department"), iReq = idx("amount requested"), iPay = idx("amount payable"),
    iStat = head.findIndex((h) => h.startsWith("final status")), iBatch = idx("batch no"),
    iPaid = idx("payment date"), iCreated = idx("ticket created date");
  const out: Row[] = [];
  for (let r = 1; r < grid.length; r++) {
    const g = grid[r]; if (!g || !g.length) continue;
    const req = num(g[iReq]), pay = num(g[iPay]);
    const pd = (g[iPaid] || "").trim();
    const dateObj = parseDate(pd) || parseDate((g[iCreated] || "").trim());
    const ticket = (g[iTicket] || "").trim(), email = (g[iEmail] || "").trim();
    if (!ticket && !email) continue;
    out.push({
      ticket, empId: (g[iEmp] || "").trim(), email, dept: cleanDept(g[iDept] || ""),
      requested: req, payable: pay, trim: Math.max(0, req - pay),
      status: (g[iStat] || "").trim() || "—", batch: (g[iBatch] || "").trim() || "—",
      paydate: pd || "—", dateObj, paid: !!dateObj,
      monthKey: dateObj ? dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, "0") : "zzz",
      monthLbl: dateObj ? MONLBL[dateObj.getMonth()] + " " + dateObj.getFullYear() : "Pending",
    });
  }
  return out;
}
const sum = (a: Row[], k: "requested" | "payable" | "trim") => a.reduce((s, r) => s + r[k], 0);
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];
function groupSum(rows: Row[], key: (r: Row) => string, metric: "payable" | "count") {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) || 0) + (metric === "payable" ? r.payable : 1));
  return [...m.entries()].map(([name, val]) => ({ name, val }));
}
function linreg(ys: number[]) {
  const n = ys.length; if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  ys.forEach((y, i) => { sx += i; sy += y; sxy += i * y; sxx += i * i; });
  const d = n * sxx - sx * sx; if (!d) return null;
  const slope = (n * sxy - sx * sy) / d, intercept = (sy - slope * sx) / n;
  return { slope, intercept, predict: (x: number) => slope * x + intercept };
}

export default function Home() {
  const [all, setAll] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [isSample, setIsSample] = useState(false);
  const [updated, setUpdated] = useState("");
  const [tab, setTab] = useState<"overview" | "analytics" | "claims">("overview");

  const [fDept, setFDept] = useState("All");
  const [fMonth, setFMonth] = useState("All");
  const [fBatch, setFBatch] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [metric, setMetric] = useState<"payable" | "count">("payable");
  const [search, setSearch] = useState("");

  const [drill, setDrill] = useState<{ type: "month" | "dept" | "batch" | "status"; key: string } | null>(null);
  const [drillHist, setDrillHist] = useState<{ type: string; key: string }[]>([]);
  const [drillStatus, setDrillStatus] = useState("All");
  const [drillDept, setDrillDept] = useState("All");
  const [drillBatch, setDrillBatch] = useState("All");
  const [drillMonth, setDrillMonth] = useState("All");
  const [galleryDim, setGalleryDim] = useState<"dept" | "batch" | "month">("dept");
  const [user, setUser] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  function load(silent = false) {
    if (!silent) { setLoading(true); setErr(""); }
    fetch(CSV_URL + "&_=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then((t) => { finish(toRows(t), false); })
      .catch(() => { if (silent) return; try { finish(toRows(SAMPLE), true); } catch { setErr("Couldn't load the sheet. Check it's still published to the web."); setLoading(false); } });
  }
  function finish(rows: Row[], sample: boolean) {
    setAll(rows); setIsSample(sample); setLoading(false);
    setUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }
  useEffect(() => { load(); const id = setInterval(() => load(true), 5 * 60 * 1000); return () => clearInterval(id); }, []);
  useEffect(() => { try { setUser(sessionStorage.getItem("opd_user")); } catch {} setAuthReady(true); }, []);
  const login = (email: string) => { try { sessionStorage.setItem("opd_user", email); } catch {} setUser(email); };
  const logout = () => { try { sessionStorage.removeItem("opd_user"); } catch {} setUser(null); };

  const batchNum = (b: string) => { const n = parseInt(b.replace(/\D/g, ""), 10); return isNaN(n) ? 999 : n; };
  const months = useMemo(() => uniq(all.map((r) => r.monthKey)).filter((k) => k !== "zzz").sort()
    .map((k) => ({ v: k, label: all.find((r) => r.monthKey === k)!.monthLbl })), [all]);
  const depts = useMemo(() => uniq(all.map((r) => r.dept)).sort(), [all]);
  const batches = useMemo(() => uniq(all.map((r) => r.batch)).sort((a, b) => batchNum(a) - batchNum(b)), [all]);
  const statuses = useMemo(() => uniq(all.map((r) => r.status)), [all]);

  const filtered = useMemo(() => all.filter((r) =>
    (fDept === "All" || r.dept === fDept) &&
    (fMonth === "All" || r.monthKey === fMonth) &&
    (fBatch === "All" || r.batch === fBatch) &&
    (fStatus === "All" || r.status === fStatus)), [all, fDept, fMonth, fBatch, fStatus]);

  const paidAll = useMemo(() => all.filter((r) => r.paid), [all]);
  const pending = useMemo(() => all.filter((r) => !r.paid), [all]);

  // monthly series (paid rows only) + projection + cumulative
  const series = useMemo(() => {
    const mk = uniq(paidAll.map((r) => r.monthKey)).sort();
    const pay = mk.map((k) => paidAll.filter((r) => r.monthKey === k).reduce((a, r) => a + r.payable, 0));
    const req = mk.map((k) => paidAll.filter((r) => r.monthKey === k).reduce((a, r) => a + r.requested, 0));
    const labels = mk.map((k) => paidAll.find((r) => r.monthKey === k)!.monthLbl.replace(" 2026", ""));
    let cum = 0; const cumul = pay.map((v) => (cum += v));
    return { mk, pay, req, labels, cumul };
  }, [paidAll]);

  const insights = useMemo(() => {
    const pay = series.pay, n = pay.length;
    if (!n) return null;
    const avg = pay.reduce((a, b) => a + b, 0) / n;
    let pi = 0; pay.forEach((v, i) => { if (v > pay[pi]) pi = i; });
    const reg = linreg(pay);
    const proj = reg ? Math.max(0, reg.predict(n)) : pay[n - 1];
    const mom = n >= 2 ? ((pay[n - 1] - pay[n - 2]) / (pay[n - 2] || 1)) * 100 : 0;
    const trimByMonth = series.mk.map((k, i) => ({ l: series.labels[i], t: series.req[i] - pay[i] })).sort((a, b) => b.t - a.t);
    const hi = Math.max(...pay), lo = Math.min(...pay);
    return { avg, peakIdx: pi, reg, proj, mom, trimTop: trimByMonth[0], hi, lo, n };
  }, [series]);

  const resetFilters = () => { setFDept("All"); setFMonth("All"); setFBatch("All"); setFStatus("All"); setSearch(""); };
  const hasFilter = fDept !== "All" || fMonth !== "All" || fBatch !== "All" || fStatus !== "All" || search.trim() !== "";

  // drill data (respects the in-drawer status filter)
  const drillData = useMemo(() => {
    if (!drill) return null;
    const base = all.filter((r) => (drill.type === "month" ? r.monthKey === drill.key : drill.type === "dept" ? r.dept === drill.key : drill.type === "batch" ? r.batch === drill.key : r.status === drill.key));
    let rows = base;
    if (drill.type !== "status" && drillStatus !== "All") rows = rows.filter((r) => r.status === drillStatus);
    if (drillDept !== "All") rows = rows.filter((r) => r.dept === drillDept);
    if (drillBatch !== "All") rows = rows.filter((r) => r.batch === drillBatch);
    if (drillMonth !== "All") rows = rows.filter((r) => r.monthKey === drillMonth);
    const pays = rows.map((r) => r.payable);
    const byDept = groupSum(rows, (r) => r.dept, "payable").sort((a, b) => b.val - a.val).map((x) => ({ ...x, d: { type: "dept", key: x.name } }));
    const byBatch = groupSum(rows, (r) => "Batch " + r.batch, "payable").sort((a, b) => b.val - a.val).map((x) => ({ ...x, d: { type: "batch", key: x.name.replace("Batch ", "") } }));
    const byMonth = uniq(rows.map((r) => r.monthKey)).filter((k) => k !== "zzz").sort().map((k) => ({ name: all.find((r) => r.monthKey === k)?.monthLbl || k, val: rows.filter((r) => r.monthKey === k).reduce((a, r) => a + r.payable, 0), d: { type: "month", key: k } }));
    const byStatus = groupSum(rows, (r) => r.status, "count");
    const optDepts = uniq(base.map((r) => r.dept)).sort();
    const optBatches = uniq(base.map((r) => r.batch)).sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
    const optMonths = uniq(base.map((r) => r.monthKey)).filter((k) => k !== "zzz").sort().map((k) => ({ v: k, label: all.find((r) => r.monthKey === k)?.monthLbl || k }));
    return {
      rows, byDept, byBatch, byMonth, byStatus, optDepts, optBatches, optMonths,
      pay: sum(rows, "payable"), req: sum(rows, "requested"), trim: sum(rows, "trim"),
      emps: uniq(rows.map((r) => r.email || r.empId)).length,
      max: pays.length ? Math.max(...pays) : 0, min: pays.length ? Math.min(...pays) : 0,
      avg: rows.length ? sum(rows, "payable") / rows.length : 0,
    };
  }, [drill, drillStatus, drillDept, drillBatch, drillMonth, all]);

  const resetSub = () => { setDrillStatus("All"); setDrillDept("All"); setDrillBatch("All"); setDrillMonth("All"); };
  const openDrill = (type: "month" | "dept" | "batch" | "status", key: string) => { resetSub(); setDrillHist([]); setDrill({ type, key }); };
  const drillInto = (type: "month" | "dept" | "batch" | "status", key: string) => {
    const prev = drill;
    if (prev) setDrillHist((h) => [...h, prev]);
    resetSub();
    if (prev) {
      if (prev.type === "month") setDrillMonth(prev.key);
      else if (prev.type === "dept") setDrillDept(prev.key);
      else if (prev.type === "batch") setDrillBatch(prev.key);
      else if (prev.type === "status") setDrillStatus(prev.key);
    }
    setDrill({ type, key });
  };
  const drillBack = () => { if (!drillHist.length) return; const prev = drillHist[drillHist.length - 1]; setDrillHist(drillHist.slice(0, -1)); resetSub(); setDrill(prev as { type: "month" | "dept" | "batch" | "status"; key: string }); };
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") setDrill(null); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  /* ---------- render ---------- */
  const font = { fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' };
  if (!authReady) return <div style={{ ...font, minHeight: "100vh", background: PAGE }} />;
  if (!user) return <Login onLogin={login} />;
  if (loading) return <div style={{ ...font, minHeight: "100vh", background: PAGE, color: CHARCOAL, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading live data…</div>;
  if (err) return <div style={{ ...font, minHeight: "100vh", background: PAGE, color: GREASE, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center" }}><div style={{ fontWeight: 700 }}>{err}</div><button onClick={() => load()} className="px-4 py-2 rounded-lg text-white" style={{ background: FLAME }}>Try again</button></div>;

  return (
    <div className="min-h-screen flex" style={{ ...font, background: PAGE, color: GREASE }}>
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 p-5" style={{ background: INK }}>
        <div className="text-2xl font-black tracking-tight text-white">dubizzle<span style={{ color: FLAME }}>labs</span></div>
        <div className="text-[11px] tracking-[0.2em] mt-1 mb-8" style={{ color: SMOKE }}>HR ANALYTICS</div>
        <nav className="flex flex-col gap-1">
          {(["overview", "analytics", "claims"] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className="text-left px-4 py-2.5 rounded-lg text-sm font-semibold capitalize"
              style={{ background: tab === k ? "rgba(224,0,0,0.16)" : "transparent", color: tab === k ? "#fff" : "#C9CACB", boxShadow: tab === k ? `inset 3px 0 0 ${FLAME}` : "none" }}>{k}</button>
          ))}
        </nav>
        <div className="mt-auto text-xs" style={{ color: SMOKE }}>
          <div className="truncate mb-2" style={{ color: "#C9CACB" }} title={user || ""}>{user}</div>
          <button onClick={logout} className="w-full mb-4 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}>Log out</button>
          <div className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full" style={{ background: FLAME }} />{isSample ? "Demo data" : "Live from Sheets"}</div>
          <div className="mt-1">OPD Reimbursements · 2026</div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* top bar */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold" style={{ color: GREASE }}>OPD Reimbursements</h1>
              <p className="text-sm mt-1" style={{ color: CHARCOAL }}>Medical claim payouts · Dubizzle Labs HR · 2026</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: SMOKE }}>{isSample ? "demo preview" : updated ? "updated " + updated : "live"}</span>
              <button onClick={() => load()} className="px-4 py-2 rounded-lg text-sm font-medium border bg-white" style={{ borderColor: CLOUD, color: GREASE }}>Refresh</button>
            </div>
          </div>

          {isSample && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#F3F4F5", border: `1px solid ${CLOUD}`, color: CHARCOAL }}>
              <b>Demo preview</b> — the live sheet couldn't be reached from here, so placeholder data is shown. In a normal browser it loads your live sheet automatically.
            </div>
          )}

          {/* mobile tabs */}
          <div className="md:hidden flex gap-1 rounded-lg p-1 bg-white" style={{ border: `1px solid ${CLOUD}` }}>
            {(["overview", "analytics", "claims"] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className="flex-1 py-2 rounded-md text-sm font-medium capitalize" style={{ background: tab === k ? FLAME : "transparent", color: tab === k ? "#fff" : CHARCOAL }}>{k}</button>
            ))}
          </div>

          {/* ===== OVERVIEW ===== */}
          {tab === "overview" && <Overview all={all} paidAll={paidAll} pending={pending} series={series} insights={insights} onDrill={openDrill} />}

          {/* ===== ANALYTICS ===== */}
          {tab === "analytics" && (
            <>
              <FilterBar {...{ fDept, setFDept, fMonth, setFMonth, fBatch, setFBatch, fStatus, setFStatus, metric, setMetric, months, depts, batches, statuses, hasFilter, resetFilters, showMetric: true }} />
              <Analytics filtered={filtered} series={series} insights={insights} metric={metric} pending={pending} onDrill={openDrill} />
            </>
          )}

          {/* ===== CLAIMS (gallery) ===== */}
          {tab === "claims" && (
            <>
              <FilterBar {...{ fDept, setFDept, fMonth, setFMonth, fBatch, setFBatch, fStatus, setFStatus, metric, setMetric, months, depts, batches, statuses, hasFilter, resetFilters, showMetric: false }} />
              <Gallery rows={filtered} dim={galleryDim} setDim={setGalleryDim} onDrill={openDrill} />
            </>
          )}
        </div>
      </main>

      {/* Drill-down drawer */}
      {drill && drillData && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrill(null)} />
          <aside className="fixed top-0 right-0 h-full w-full sm:w-[440px] bg-white z-50 shadow-2xl overflow-y-auto">
            <DrillPanel drill={drill} data={drillData} statuses={statuses}
              drillStatus={drillStatus} setDrillStatus={setDrillStatus}
              drillDept={drillDept} setDrillDept={setDrillDept}
              drillBatch={drillBatch} setDrillBatch={setDrillBatch}
              drillMonth={drillMonth} setDrillMonth={setDrillMonth}
              onDrill={drillInto} onBack={drillBack} canBack={drillHist.length > 0}
              onClose={() => { setDrill(null); setDrillHist([]); }}
              onApply={() => { if (drill.type === "month") setFMonth(drill.key); else if (drill.type === "dept") setFDept(drill.key); else if (drill.type === "batch") setFBatch(drill.key); else setFStatus(drill.key); if (drill.type !== "status" && drillStatus !== "All") setFStatus(drillStatus); setTab("analytics"); setDrill(null); setDrillHist([]); }} />
          </aside>
        </>
      )}
    </div>
  );
}

/* ================= OVERVIEW ================= */
function Overview({ all, paidAll, pending, series, insights, onDrill }: any) {
  const req = sum(paidAll, "requested"), pay = sum(paidAll, "payable"), trim = Math.max(0, req - pay);
  const paidPct = req > 0 ? (pay / req) * 100 : 100;
  const dept = groupSum(paidAll, (r: Row) => r.dept, "payable").sort((a, b) => b.val - a.val).slice(0, 12);
  const maxDept = Math.max(1, ...dept.map((d) => d.val));
  const cleared = all.filter((r: Row) => r.status === "Payment Cleared").length;
  const under = pending.length;
  const total = Math.max(1, cleared + under);

  return (
    <>
      {/* hero */}
      <section className="rounded-2xl bg-white border p-6" style={{ borderColor: CLOUD }}>
        <div className="grid md:grid-cols-[320px_1fr] gap-8 items-center">
          <div>
            <div className="text-sm" style={{ color: CHARCOAL }}>Total paid out</div>
            <div className="text-4xl md:text-5xl font-black mt-1" style={{ color: FLAME, letterSpacing: "-0.02em" }}>{pkr(pay)}</div>
            <div className="text-sm mt-2" style={{ color: CHARCOAL }}>{paidAll.length} claims paid{under ? ` · ${under} under process (${pkr(sum(pending, "payable"))})` : ""}</div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2" style={{ color: CHARCOAL }}><span>Requested <b style={{ color: GREASE }}>{pkr(req)}</b></span><span>Trimmed by HR <b style={{ color: GREASE }}>{pkr(trim)}</b></span></div>
            <div className="flex h-9 rounded-lg overflow-hidden" style={{ background: TRACK, border: `1px solid ${CLOUD}` }}>
              <div className="h-full flex items-center px-3 text-xs font-semibold text-white" style={{ width: paidPct + "%", background: FLAME }}>{paidPct > 14 ? "Paid " + paidPct.toFixed(0) + "%" : ""}</div>
              <div className="h-full flex items-center px-3 text-xs font-semibold" style={{ width: 100 - paidPct + "%", color: CHARCOAL }}>{100 - paidPct > 10 ? (100 - paidPct).toFixed(0) + "%" : ""}</div>
            </div>
          </div>
        </div>
      </section>

      {/* tiles */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Total requested" value={pkr(req)} />
        <Tile label="Employees claiming" value={String(uniq(paidAll.map((r: Row) => r.email || r.empId)).length)} />
        <Tile label="Average per claim" value={pkr(paidAll.length ? pay / paidAll.length : 0)} />
        <Tile label="Payment batches" value={String(uniq(paidAll.map((r: Row) => r.batch)).length)} />
      </section>

      {/* exec summary */}
      <ExecPanel title="Executive summary" summary={
        `In 2026, ${paidAll.length} OPD claims worth ${pkr(pay)} have been paid out${under ? `, with ${pkr(sum(pending, "payable"))} (${under} claims) still under process` : ""}. HR review reduced requests by ${pkr(trim)} (${req ? (trim / req * 100).toFixed(1) : 0}%)${dept[0] ? `, and ${dept[0].name} is the highest-spending team at ${pkr(dept[0].val)}` : ""}.`
      } insights={[
        `HR trims about ${pkr(paidAll.length ? trim / paidAll.length : 0)} from the average paid claim.`,
        dept.length ? `Top 3 teams by spend: ${dept.slice(0, 3).map((d) => `${d.name} (${short(d.val)})`).join(", ")}.` : "",
        `${cleared} claims cleared · ${under} still under process (${Math.round(under / total * 100)}% pending).`,
      ].filter(Boolean)} />

      <div className="grid lg:grid-cols-2 gap-5">
        {/* dept */}
        <Card title="Spend by department" hint="Click to drill down">
          <BarList rows={dept} max={maxDept} onClick={(n: string) => onDrill("dept", n)} fmt={short} />
        </Card>
        {/* status (new) */}
        <Card title="Cleared vs under process" hint="Payment status of all claims">
          <div className="flex h-4 w-full overflow-hidden rounded-full mb-4" style={{ background: TRACK }}>
            <div style={{ width: cleared / total * 100 + "%", background: FLAME }} />
            <div style={{ width: under / total * 100 + "%", background: SMOKE }} />
          </div>
          {([["Payment Cleared", cleared, FLAME], ["Payment Under Process", under, SMOKE]] as const).map(([name, cnt, col]) => (
            <button key={name} onClick={() => onDrill("status", name)} className="w-full flex items-center justify-between text-sm py-1.5">
              <span className="inline-flex items-center gap-2" style={{ color: CHARCOAL }}><span className="w-3 h-3 rounded-full inline-block" style={{ background: col }} />{name}</span>
              <span className="font-medium tabular-nums" style={{ color: GREASE }}>{cnt} ({Math.round(cnt / total * 100)}%) <span style={{ color: FLAME }}>→</span></span>
            </button>
          ))}
          <div className="mt-4 pt-4 text-sm" style={{ borderTop: `1px solid ${CLOUD}`, color: CHARCOAL }}>
            Pending outflow <b style={{ color: GREASE }}>{pkr(sum(pending, "payable"))}</b> not yet paid.
          </div>
        </Card>
      </div>
    </>
  );
}

/* ================= ANALYTICS ================= */
function Analytics({ filtered, series, insights, metric, pending, onDrill }: any) {
  const monthAgg = useMemo(() => {
    const mk = uniq(filtered.filter((r: Row) => r.paid).map((r: Row) => r.monthKey)).sort();
    return mk.map((k) => ({ key: k, label: filtered.find((r: Row) => r.monthKey === k)!.monthLbl.replace(" 2026", ""), val: filtered.filter((r: Row) => r.monthKey === k).reduce((a: number, r: Row) => a + (metric === "payable" ? r.payable : 1), 0), req: filtered.filter((r: Row) => r.monthKey === k).reduce((a: number, r: Row) => a + r.requested, 0), pay: filtered.filter((r: Row) => r.monthKey === k).reduce((a: number, r: Row) => a + r.payable, 0) }));
  }, [filtered, metric]);
  const reg = useMemo(() => linreg(monthAgg.map((m: any) => m.val)), [monthAgg]);
  const proj = reg && monthAgg.length >= 3 ? Math.max(0, reg.predict(monthAgg.length)) : null;
  const maxMonth = Math.max(1, ...monthAgg.map((m: any) => m.val), proj || 0);
  const maxRP = Math.max(1, ...monthAgg.map((m: any) => Math.max(m.req, m.pay)));

  const dept = groupSum(filtered, (r: Row) => r.dept, metric).sort((a, b) => b.val - a.val);
  const maxD = Math.max(1, ...dept.map((d) => d.val));
  const batch = groupSum(filtered, (r: Row) => r.batch, metric).sort((a, b) => Number(a.name.replace(/\D/g, "")) - Number(b.name.replace(/\D/g, "")));
  const maxB = Math.max(1, ...batch.map((b) => b.val));

  // cumulative (new) from filtered paid
  const cumul = useMemo(() => { let c = 0; return monthAgg.map((m: any) => ({ label: m.label, v: (c += m.pay) })); }, [monthAgg]);
  const fmt = metric === "payable" ? short : (n: number) => String(Math.round(n));

  return (
    <>
      {/* monthly payout + projection */}
      <Card title={metric === "payable" ? "Amount paid per month" : "Claims per month"} hint="Click a month to drill down">
        <div className="flex items-end gap-2 md:gap-3 h-56">
          {monthAgg.map((m: any) => (
            <button key={m.key} onClick={() => onDrill("month", m.key)} className="flex-1 h-full flex flex-col items-center" title={`${m.label}: ${fmt(m.val)}`}>
              <div className="flex-1 w-full flex items-end justify-center"><div className="w-5 md:w-7 rounded-t" style={{ height: m.val / maxMonth * 100 + "%", background: BRICK }} /></div>
              <span className="mt-2 text-[11px]" style={{ color: CHARCOAL }}>{m.label}</span>
            </button>
          ))}
          {proj != null && (
            <div className="flex-1 h-full flex flex-col items-center" title={`Projected: ${short(proj)}`}>
              <div className="flex-1 w-full flex items-end justify-center"><div className="w-5 md:w-7 rounded-t" style={{ height: proj / maxMonth * 100 + "%", background: "#E6AEAE", border: `1px dashed ${BRICK}` }} /></div>
              <span className="mt-2 text-[11px]" style={{ color: SMOKE }}>Next (proj)</span>
            </div>
          )}
        </div>
      </Card>

      {/* cumulative (new) + forecast */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Cumulative payout" hint="Running total across the year">
          <LineChart points={cumul.map((c: any) => c.v)} labels={cumul.map((c: any) => c.label)} />
        </Card>
        <Card title="Forecast" hint="Directional, from the monthly trend">
          <div className="grid grid-cols-1 gap-3">
            <MiniStat label="Next month (projected)" value={proj != null ? short(proj) : "—"} sub={reg ? (reg.slope >= 0 ? "trending up" : "trending down") : ""} />
            <MiniStat label="Pending outflow" value={pkr(sum(pending, "payable"))} sub="claims under process" />
            <MiniStat label="Annualised run-rate" value={monthAgg.length ? short(monthAgg.reduce((a: number, m: any) => a + m.pay, 0) / monthAgg.length * 12) : "—"} sub="≈ avg/mo × 12" />
          </div>
        </Card>
      </div>

      {/* requested vs payable */}
      <Card title="Requested vs payable" hint="By month">
        <div className="flex items-end gap-2 md:gap-3 h-48">
          {monthAgg.map((m: any) => (
            <button key={m.key} onClick={() => onDrill("month", m.key)} className="flex-1 h-full flex flex-col items-center">
              <div className="flex-1 w-full flex items-end justify-center gap-1">
                <div className="w-2.5 rounded-t" style={{ height: m.req / maxRP * 100 + "%", background: SMOKE }} title={`Requested ${short(m.req)}`} />
                <div className="w-2.5 rounded-t" style={{ height: m.pay / maxRP * 100 + "%", background: FLAME }} title={`Payable ${short(m.pay)}`} />
              </div>
              <span className="mt-2 text-[11px]" style={{ color: CHARCOAL }}>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-xs" style={{ color: CHARCOAL }}>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ background: FLAME }} />Payable</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ background: SMOKE }} />Requested</span>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="By department" hint="Click to drill down">
          <div className="max-h-96 overflow-y-auto pr-1"><BarList rows={dept} max={maxD} onClick={(n: string) => onDrill("dept", n)} fmt={fmt} /></div>
        </Card>
        <Card title="By batch" hint="Click to drill down">
          <div className="max-h-96 overflow-y-auto pr-1"><BarList rows={batch.map((b) => ({ name: "Batch " + b.name, val: b.val }))} max={maxB} onClick={(n: string) => onDrill("batch", n.replace("Batch ", ""))} fmt={fmt} /></div>
        </Card>
      </div>
    </>
  );
}

/* ================= CLAIMS ================= */
function ClaimsTable({ rows, search, onDrill }: any) {
  const q = search.trim().toLowerCase();
  const view = useMemo(() => rows.filter((r: Row) => !q || r.email.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q) || r.ticket.toLowerCase().includes(q)).sort((a: Row, b: Row) => b.payable - a.payable), [rows, q]);
  return (
    <Card title="Claims detail" hint={`${view.length} claims · matches filters`}>
      <div className="overflow-auto max-h-[34rem]">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-white">
            <tr style={{ color: CHARCOAL, borderBottom: `2px solid ${CLOUD}` }}>
              <Th>Ticket</Th><Th>Employee</Th><Th>Department</Th><Th right>Requested</Th><Th right>Payable</Th><Th right>Adj.</Th><Th>Batch</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {view.map((r: Row, i: number) => (
              <tr key={i} className="cursor-pointer" style={{ borderBottom: `1px solid ${CLOUD}` }} onClick={() => onDrill("month", r.monthKey !== "zzz" ? r.monthKey : "")}>
                <Td>{r.ticket}</Td>
                <Td><div>{empName(r.email)}</div><div style={{ fontSize: 11, color: SMOKE }}>{r.empId}</div></Td>
                <Td>{r.dept}</Td>
                <Td right>{pkr(r.requested)}</Td>
                <Td right>{pkr(r.payable)}</Td>
                <Td right><span style={{ color: r.trim > 0 ? CHARCOAL : SMOKE }}>{r.trim > 0 ? "−" + pkr(r.trim) : "—"}</span></Td>
                <Td>{r.batch}</Td>
                <Td><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: STATUS_COLORS[r.status] || SMOKE }} />{r.status}</span></Td>
              </tr>
            ))}
            {!view.length && <tr><Td>{""}</Td><td colSpan={7} className="py-10 text-center" style={{ color: SMOKE }}>No claims match these filters.</td></tr>}
          </tbody>
          <tfoot>
            <tr style={{ color: GREASE, fontWeight: 600, borderTop: `2px solid ${CLOUD}` }}>
              <Td>Total</Td><Td>{""}</Td><Td>{""}</Td><Td right>{pkr(sum(view, "requested"))}</Td><Td right>{pkr(sum(view, "payable"))}</Td><Td right>{pkr(sum(view, "trim"))}</Td><Td>{""}</Td><Td>{""}</Td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/* ================= DRILL PANEL ================= */
function DrillPanel({ drill, data, statuses, drillStatus, setDrillStatus, drillDept, setDrillDept, drillBatch, setDrillBatch, drillMonth, setDrillMonth, onDrill, onBack, canBack, onClose, onApply }: any) {
  const title = drill.type === "month" ? (data.rows[0]?.monthLbl || drill.key) : drill.type === "batch" ? "Batch " + drill.key : drill.key;
  const sub = drill.type === "month" ? "Payment month" : drill.type === "batch" ? "Payment batch" : drill.type === "status" ? "Payment status" : "Department";
  const ranked = drill.type === "dept" ? data.byMonth : data.byDept;
  const rankLabel = drill.type === "dept" ? "By month" : "By department";
  const secondary = drill.type === "dept" ? data.byBatch : drill.type === "month" ? data.byBatch : data.byMonth;
  const secLabel = drill.type === "dept" ? "By batch" : drill.type === "month" ? "By batch" : "By month";
  const maxR = Math.max(1, ...ranked.map((x: any) => x.val));
  const maxS = Math.max(1, ...secondary.map((x: any) => x.val));
  const statusTotal = Math.max(1, data.byStatus.reduce((a: number, s: any) => a + s.val, 0));

  return (
    <div className="p-5">
      <div className="flex items-start justify-between">
        <div>
          {canBack && <button onClick={onBack} className="text-xs font-semibold mb-1 inline-block" style={{ color: FLAME }}>← Back</button>}
          <div className="text-xs uppercase tracking-wide" style={{ color: SMOKE }}>{sub}</div>
          <h3 className="text-xl font-bold" style={{ color: GREASE }}>{title}</h3>
        </div>
        <button onClick={onClose} className="text-2xl leading-none px-2" style={{ color: CHARCOAL }}>×</button>
      </div>

      {/* in-drawer status filter */}
      {drill.type !== "status" && (
      <div className="flex gap-1 mt-4 rounded-lg p-1" style={{ background: PAGE }}>
        {["All", ...statuses].map((s: string) => (
          <button key={s} onClick={() => setDrillStatus(s)} className="flex-1 py-1.5 rounded-md text-xs font-medium"
            style={{ background: drillStatus === s ? FLAME : "transparent", color: drillStatus === s ? "#fff" : CHARCOAL }}>
            {s === "Payment Cleared" ? "Cleared" : s === "Payment Under Process" ? "Pending" : s}
          </button>
        ))}
      </div>
      )}

      {/* extra drill filters */}
      <div className="flex flex-wrap gap-2 mt-2">
        {drill.type !== "month" && (
          <select value={drillMonth} onChange={(e) => setDrillMonth(e.target.value)} className="flex-1 min-w-[6.5rem] px-2 py-1.5 text-xs rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }}>
            <option value="All">All months</option>
            {data.optMonths.map((m: any) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        )}
        {drill.type !== "dept" && (
          <select value={drillDept} onChange={(e) => setDrillDept(e.target.value)} className="flex-1 min-w-[6.5rem] px-2 py-1.5 text-xs rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }}>
            <option value="All">All departments</option>
            {data.optDepts.map((d: string) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {drill.type !== "batch" && (
          <select value={drillBatch} onChange={(e) => setDrillBatch(e.target.value)} className="flex-1 min-w-[6.5rem] px-2 py-1.5 text-xs rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }}>
            <option value="All">All batches</option>
            {data.optBatches.map((b: string) => <option key={b} value={b}>Batch {b}</option>)}
          </select>
        )}
      </div>

      {/* richer stats */}
      <div className="grid grid-cols-2 gap-2.5 mt-4">
        <Stat label="Paid out" value={pkr(data.pay)} accent={FLAME} />
        <Stat label="Requested" value={pkr(data.req)} />
        <Stat label="Trimmed by HR" value={pkr(data.trim)} />
        <Stat label="Claims" value={String(data.rows.length)} />
        <Stat label="Employees" value={String(data.emps)} />
        <Stat label="Avg / claim" value={pkr(data.avg)} />
        <Stat label="Largest claim" value={pkr(data.max)} />
        <Stat label="Smallest claim" value={pkr(data.min)} />
      </div>

      <PanelBars title={rankLabel} rows={ranked} max={maxR} onPick={onDrill} />
      <PanelBars title={secLabel} rows={secondary} max={maxS} onPick={onDrill} />

      <div className="mt-5">
        <div className="text-sm font-semibold mb-2" style={{ color: GREASE }}>Status</div>
        {data.byStatus.map((s: any) => (
          <div key={s.name} className="flex items-center justify-between text-sm py-1">
            <span className="inline-flex items-center gap-2" style={{ color: CHARCOAL }}><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: STATUS_COLORS[s.name] || SMOKE }} />{s.name}</span>
            <span className="font-medium" style={{ color: GREASE }}>{s.val} ({Math.round(s.val / statusTotal * 100)}%)</span>
          </div>
        ))}
      </div>

      {/* claims list */}
      <div className="mt-5">
        <div className="text-sm font-semibold mb-2" style={{ color: GREASE }}>Claims ({data.rows.length})</div>
        <div className="max-h-72 overflow-y-auto">
          {[...data.rows].sort((a: Row, b: Row) => b.payable - a.payable).slice(0, 60).map((r: Row, i: number) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm" style={{ borderBottom: `1px solid ${CLOUD}` }}>
              <span><b>{r.ticket}</b><span className="block text-xs" style={{ color: SMOKE }}>{r.dept} · Batch {r.batch}</span></span>
              <span className="text-right font-medium tabular-nums" style={{ color: GREASE }}>{pkr(r.payable)}{r.trim > 0 && <span className="block text-xs" style={{ color: CHARCOAL }}>−{pkr(r.trim)}</span>}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <button onClick={onApply} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: FLAME }}>Apply as filter</button>
        <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: CLOUD, color: CHARCOAL }}>Close</button>
      </div>
    </div>
  );
}

/* ================= SHARED UI ================= */
function FilterBar(props: any) {
  const { fDept, setFDept, fMonth, setFMonth, fBatch, setFBatch, fStatus, setFStatus, metric, setMetric, months, depts, batches, statuses, hasFilter, resetFilters, showMetric, search, setSearch } = props;
  return (
    <section className="rounded-2xl bg-white border p-4 flex flex-wrap items-end gap-3" style={{ borderColor: CLOUD }}>
      <Sel label="Department" value={fDept} onChange={setFDept} options={depts} />
      <SelM label="Month" value={fMonth} onChange={setFMonth} options={months} />
      <Sel label="Batch" value={fBatch} onChange={setFBatch} options={batches} prefix="Batch " />
      <Sel label="Status" value={fStatus} onChange={setFStatus} options={statuses} />
      {showMetric && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: CHARCOAL }}>Measure</span>
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: CLOUD }}>
            {(["payable", "count"] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)} className="px-3 py-2 text-sm font-medium" style={{ background: metric === m ? FLAME : "#fff", color: metric === m ? "#fff" : CHARCOAL }}>{m === "payable" ? "Amount" : "Claims"}</button>
            ))}
          </div>
        </div>
      )}
      {setSearch && (
        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-xs font-medium" style={{ color: CHARCOAL }}>Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email, ID or ticket…" className="px-3 py-2 text-sm rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }} />
        </div>
      )}
      {hasFilter && <button onClick={resetFilters} className="ml-auto px-3 py-2 text-sm font-medium rounded-lg border" style={{ borderColor: CLOUD, color: FLAME }}>Reset</button>}
    </section>
  );
}
function Sel({ label, value, onChange, options, prefix = "" }: any) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: CHARCOAL }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2 text-sm rounded-lg border bg-white min-w-[8.5rem]" style={{ borderColor: CLOUD, color: GREASE }}>
        <option value="All">All</option>
        {options.map((o: string) => <option key={o} value={o}>{prefix}{o}</option>)}
      </select>
    </div>
  );
}
function SelM({ label, value, onChange, options }: any) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: CHARCOAL }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2 text-sm rounded-lg border bg-white min-w-[8.5rem]" style={{ borderColor: CLOUD, color: GREASE }}>
        <option value="All">All</option>
        {options.map((o: any) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  );
}
function Card({ title, hint, children }: any) {
  return (
    <section className="rounded-2xl bg-white border p-5" style={{ borderColor: CLOUD }}>
      <div className="flex items-center justify-between mb-4"><h2 className="font-semibold" style={{ color: GREASE }}>{title}</h2>{hint && <span className="text-xs" style={{ color: SMOKE }}>{hint}</span>}</div>
      {children}
    </section>
  );
}
function Tile({ label, value }: any) {
  return <div className="bg-white rounded-2xl border p-5" style={{ borderColor: CLOUD }}><div className="text-xs" style={{ color: CHARCOAL }}>{label}</div><div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: GREASE }}>{value}</div></div>;
}
function ExecPanel({ title, summary, insights }: any) {
  return (
    <section className="rounded-2xl bg-white border p-6" style={{ borderColor: CLOUD }}>
      <span className="inline-block text-xs font-bold tracking-wide px-3 py-1 rounded-full mb-4" style={{ background: "#FBE3E3", color: FLAME }}>{title.toUpperCase()}</span>
      <p className="text-base leading-relaxed" style={{ color: GREASE }}>{summary}</p>
      <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${CLOUD}` }}>
        <div className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: FLAME }}><span>✦</span> AI insights</div>
        <ul className="space-y-2.5 text-sm" style={{ color: CHARCOAL }}>
          {insights.map((t: string, i: number) => <li key={i} className="flex gap-2.5"><span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0 inline-block" style={{ background: FLAME }} /><span>{t}</span></li>)}
        </ul>
      </div>
    </section>
  );
}
function BarList({ rows, max, onClick, fmt }: any) {
  return (
    <div className="space-y-2.5">
      {rows.map((d: any, i: number) => (
        <button key={d.name + i} onClick={() => onClick && onClick(d.name)} className="w-full flex items-center gap-3 text-left">
          <div className="w-32 shrink-0 text-sm truncate" style={{ color: CHARCOAL }}>{d.name}</div>
          <div className="flex-1 rounded-full h-3 overflow-hidden" style={{ background: TRACK }}><div className="h-3 rounded-full" style={{ width: d.val / max * 100 + "%", background: redShade(d.val, max) }} /></div>
          <div className="w-16 shrink-0 text-right text-sm font-medium tabular-nums" style={{ color: GREASE }}>{fmt(d.val)}</div>
        </button>
      ))}
    </div>
  );
}
function PanelBars({ title, rows, max, onPick }: any) {
  const clickable = onPick && rows.some((x: any) => x.d);
  return (
    <div className="mt-5">
      <div className="text-sm font-semibold mb-2" style={{ color: GREASE }}>{title}{clickable && <span className="font-normal ml-2" style={{ color: SMOKE, fontSize: 11 }}>click to drill in</span>}</div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {rows.map((x: any, i: number) => {
          const can = !!(x.d && onPick);
          const El: any = can ? "button" : "div";
          return (
            <El key={x.name + i} onClick={can ? () => onPick(x.d.type, x.d.key) : undefined} className="w-full flex items-center gap-2 text-left rounded-md" style={can ? { cursor: "pointer" } : undefined}>
              <div className="w-24 shrink-0 text-xs truncate" style={{ color: can ? FLAME : CHARCOAL }}>{x.name}</div>
              <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: TRACK }}><div className="h-2.5 rounded-full" style={{ width: x.val / max * 100 + "%", background: redShade(x.val, max) }} /></div>
              <div className="w-14 shrink-0 text-right text-xs font-medium tabular-nums" style={{ color: GREASE }}>{short(x.val)}</div>
            </El>
          );
        })}
        {!rows.length && <div className="text-xs" style={{ color: SMOKE }}>None</div>}
      </div>
    </div>
  );
}
function LineChart({ points, labels }: { points: number[]; labels: string[] }) {
  if (points.length < 2) return <div className="text-sm" style={{ color: SMOKE }}>Not enough data yet.</div>;
  const W = 560, H = 200, PL = 50, PR = 12, PT = 12, PB = 26;
  const max = Math.max(1, ...points), plotW = W - PL - PR, plotH = H - PT - PB;
  const pts = points.map((v, i) => ({ x: PL + (i * plotW) / (points.length - 1), y: PT + (1 - v / max) * plotH }));
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${PL},${PT + plotH} ${line} ${PL + plotW},${PT + plotH}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[0, 1, 2].map((g) => { const y = PT + (g / 2) * plotH; return <g key={g}><line x1={PL} y1={y} x2={PL + plotW} y2={y} stroke="#eef0f3" /><text x={PL - 8} y={y + 4} textAnchor="end" fontSize={10} fill={SMOKE}>{short(max * (1 - g / 2))}</text></g>; })}
      <polygon points={area} fill={FLAME} fillOpacity={0.1} />
      <polyline points={line} fill="none" stroke={FLAME} strokeWidth={2.5} strokeLinejoin="round" />
      {pts.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r={3} fill={FLAME} /><text x={p.x} y={H - 8} textAnchor="middle" fontSize={10} fill={CHARCOAL}>{labels[i]}</text></g>)}
    </svg>
  );
}
function MiniStat({ label, value, sub }: any) {
  return <div className="rounded-xl p-4" style={{ background: PAGE }}><div className="text-xs" style={{ color: CHARCOAL }}>{label}</div><div className="text-xl font-bold mt-0.5" style={{ color: FLAME }}>{value}</div>{sub && <div className="text-xs mt-0.5" style={{ color: SMOKE }}>{sub}</div>}</div>;
}
function Stat({ label, value, accent = GREASE }: any) {
  return <div className="rounded-xl p-3" style={{ background: PAGE }}><div className="text-xs" style={{ color: SMOKE }}>{label}</div><div className="text-base font-bold tabular-nums" style={{ color: accent }}>{value}</div></div>;
}
function Row2({ color, label, value }: any) {
  return <div className="flex items-center justify-between text-sm py-1.5"><span className="inline-flex items-center gap-2" style={{ color: CHARCOAL }}><span className="w-3 h-3 rounded-full inline-block" style={{ background: color }} />{label}</span><span className="font-medium tabular-nums" style={{ color: GREASE }}>{value}</span></div>;
}
function Th({ children, right }: any) { return <th className={`py-2 px-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>; }
function Td({ children, right }: any) { return <td className={`py-2 px-2 tabular-nums ${right ? "text-right" : "text-left"}`} style={{ color: CHARCOAL }}>{children}</td>; }
function Gallery({ rows, dim, setDim, onDrill }: any) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"amount" | "claims" | "name">("amount");
  const groups = useMemo(() => {
    const keyFn = dim === "dept" ? (r: Row) => r.dept : dim === "batch" ? (r: Row) => r.batch : (r: Row) => r.monthKey;
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = keyFn(r); if (dim === "month" && k === "zzz") continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    const label = (k: string) => dim === "batch" ? "Batch " + k : dim === "month" ? (rows.find((r: Row) => r.monthKey === k)?.monthLbl || k) : k;
    return [...m.entries()].map(([k, rs]) => ({
      k, label: label(k),
      pay: rs.reduce((a, r) => a + r.payable, 0), req: rs.reduce((a, r) => a + r.requested, 0),
      claims: rs.length, emps: new Set(rs.map((r) => r.email || r.empId)).size,
    }));
  }, [rows, dim]);
  const max = Math.max(1, ...groups.map((g) => g.pay));
  const drillType = dim === "dept" ? "dept" : dim === "batch" ? "batch" : "month";

  const shown = useMemo(() => {
    let g = groups.filter((x) => x.label.toLowerCase().includes(q.trim().toLowerCase()));
    if (sort === "amount") g = [...g].sort((a, b) => b.pay - a.pay);
    else if (sort === "claims") g = [...g].sort((a, b) => b.claims - a.claims);
    else g = [...g].sort((a, b) => dim === "batch" ? Number(a.k.replace(/\D/g, "")) - Number(b.k.replace(/\D/g, "")) : a.label.localeCompare(b.label));
    return g;
  }, [groups, q, sort, dim]);

  const exportCsv = () => {
    const head = ["Name", "Paid", "Requested", "Trimmed", "Claims", "People"];
    const lines = shown.map((g) => [g.label, Math.round(g.pay), Math.round(g.req), Math.round(Math.max(0, g.req - g.pay)), g.claims, g.emps]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = `opd-${dim}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg p-1 bg-white" style={{ border: `1px solid ${CLOUD}` }}>
          {([["dept", "By department"], ["batch", "By batch"], ["month", "By month"]] as const).map(([d, l]) => (
            <button key={d} onClick={() => setDim(d)} className="px-3 py-1.5 rounded-md text-sm font-medium" style={{ background: dim === d ? FLAME : "transparent", color: dim === d ? "#fff" : CHARCOAL }}>{l}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="px-3 py-2 text-sm rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as "amount" | "claims" | "name")} className="px-3 py-2 text-sm rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }}>
          <option value="amount">Sort: Amount</option>
          <option value="claims">Sort: Claims</option>
          <option value="name">Sort: Name</option>
        </select>
        <button onClick={exportCsv} className="ml-auto px-3 py-2 text-sm font-medium rounded-lg border bg-white" style={{ borderColor: CLOUD, color: GREASE }}>Export CSV</button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        {shown.map((g) => (
          <button key={g.k} onClick={() => onDrill(drillType, g.k)} className="text-left rounded-2xl bg-white border p-5 hover:shadow-md transition-shadow" style={{ borderColor: CLOUD }}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold truncate" style={{ color: GREASE }}>{g.label}</div>
              <span className="text-[11px] px-2 py-0.5 rounded-full shrink-0" style={{ background: "#FBE3E3", color: FLAME }}>{g.claims} claims</span>
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums" style={{ color: FLAME }}>{short(g.pay)}</div>
            <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: TRACK }}><div className="h-2 rounded-full" style={{ width: g.pay / max * 100 + "%", background: redShade(g.pay, max) }} /></div>
            <div className="flex justify-between mt-3 text-xs" style={{ color: CHARCOAL }}>
              <span>Avg {short(g.claims ? g.pay / g.claims : 0)}</span>
              <span>Trimmed {short(Math.max(0, g.req - g.pay))}</span>
              <span>{g.emps} people</span>
            </div>
            <div className="mt-3 pt-3 text-xs font-semibold flex items-center justify-end gap-1" style={{ borderTop: `1px solid ${CLOUD}`, color: FLAME }}>View details <span aria-hidden>→</span></div>
          </button>
        ))}
        {!shown.length && <div className="text-sm col-span-full" style={{ color: SMOKE }}>No results.</div>}
      </div>
    </>
  );
}

function Login({ onLogin }: { onLogin: (email: string) => void }) {
  const [mode, setMode] = useState<"login" | "change">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");

  const doLogin = () => {
    const e = email.trim().toLowerCase();
    if (getPassword(e) && getPassword(e) === pw) onLogin(e);
    else setMsg("Wrong email or password.");
  };
  const doChange = () => {
    const e = email.trim().toLowerCase();
    if (!getPassword(e)) { setMsg("No account with that email."); return; }
    if (getPassword(e) !== curPw) { setMsg("Current password is wrong."); return; }
    if (newPw.length < 4) { setMsg("New password must be at least 4 characters."); return; }
    setStoredPassword(e, newPw); setOk("Password updated — you can sign in now."); setMsg(""); setMode("login"); setPw(""); setCurPw(""); setNewPw("");
  };

  const inp: CSSProperties = { width: "100%", padding: "10px 12px", margin: "6px 0 14px", borderRadius: 10, border: `1px solid ${CLOUD}`, fontSize: 14, color: GREASE, outline: "none", boxSizing: "border-box" };
  const btn: CSSProperties = { width: "100%", padding: "11px", borderRadius: 10, background: FLAME, color: "#fff", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer", marginTop: 4 };

  return (
    <div style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', minHeight: "100vh", background: INK, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @keyframes opdFloat { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(28px,-38px) scale(1.15)} }
        @keyframes opdCard { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        .opd-blob{position:absolute;border-radius:9999px;filter:blur(64px);animation:opdFloat 9s ease-in-out infinite}
        @media (prefers-reduced-motion:reduce){.opd-blob{animation:none}}
      `}</style>
      <div className="opd-blob" style={{ width: 340, height: 340, top: -70, left: -50, background: "#E00000", opacity: 0.35 }} />
      <div className="opd-blob" style={{ width: 300, height: 300, bottom: -60, right: -40, background: "#7E1515", opacity: 0.4, animationDelay: "-3s" }} />
      <div className="opd-blob" style={{ width: 220, height: 220, top: "42%", right: "22%", background: "#3a3b3c", opacity: 0.5, animationDelay: "-6s" }} />

      <div style={{ position: "relative", width: "100%", maxWidth: 400, animation: "opdCard .5s ease both" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-0.02em", color: "#fff" }}>dubizzle<span style={{ color: FLAME }}>labs</span></div>
          <div style={{ fontSize: 12, letterSpacing: "0.22em", color: SMOKE, marginTop: 4 }}>HR ANALYTICS</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 18, padding: 28, boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: GREASE, margin: 0 }}>{mode === "login" ? "Sign in" : "Change password"}</h1>
          <p style={{ fontSize: 13, color: CHARCOAL, margin: "4px 0 18px" }}>OPD Reimbursements dashboard</p>

          <label style={{ fontSize: 12, color: CHARCOAL }}>Email</label>
          <input value={email} onChange={(e) => { setEmail(e.target.value); setMsg(""); }} onKeyDown={(e) => { if (e.key === "Enter") mode === "login" ? doLogin() : doChange(); }} autoFocus placeholder="you@dubizzlelabs.com" style={inp} />

          {mode === "login" ? (
            <>
              <label style={{ fontSize: 12, color: CHARCOAL }}>Password</label>
              <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setMsg(""); }} onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }} placeholder="••••••" style={inp} />
              <button onClick={doLogin} style={btn}>Log in</button>
            </>
          ) : (
            <>
              <label style={{ fontSize: 12, color: CHARCOAL }}>Current password</label>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} style={inp} />
              <label style={{ fontSize: 12, color: CHARCOAL }}>New password</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doChange(); }} style={inp} />
              <button onClick={doChange} style={btn}>Update password</button>
            </>
          )}

          {msg && <p style={{ color: FLAME, fontSize: 13, marginTop: 10 }}>{msg}</p>}
          {ok && <p style={{ color: "#1F7A3D", fontSize: 13, marginTop: 10 }}>{ok}</p>}

          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button onClick={() => { setMode(mode === "login" ? "change" : "login"); setMsg(""); setOk(""); }} style={{ background: "none", border: "none", color: CHARCOAL, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
              {mode === "login" ? "Change / reset password" : "Back to sign in"}
            </button>
          </div>
        </div>
        <p style={{ textAlign: "center", color: SMOKE, fontSize: 11, marginTop: 16 }}>Dubizzle Labs · HR · authorised users only</p>
      </div>
    </div>
  );
}