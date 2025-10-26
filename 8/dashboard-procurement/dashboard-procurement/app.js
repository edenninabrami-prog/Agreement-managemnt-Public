/* 
=========================
   FOREST • OPS — app.js
   גרסה: 3.4.0 (RTL – unified filters + progress rail)
========================= */
/* ---------- Config ---------- */
const LS_KEY   = 'forest_ops_projects_v1';
const ADMIN_CODE = '2468';            // קוד מנהל (דמו בלבד)
const UNLOCK_WINDOW_MIN = 20;         // זמן עריכה לאחר אימות (דקות)
const LOCK_AFTER_HOURS  = 24;         // נעילה (שקטה) לאחר 24 שעות
const SESSION_PREFIX    = 'forest_ops_unlock_'; // sessionStorage key prefix

/* ---------- Utilities ---------- */
function loadProjects(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw){ return []; }
    return JSON.parse(raw) || [];
  }catch(e){
    console.warn('loadProjects error:', e);
    return [];
  }
}
function notifyProjectsChanged(){
  try { window.dispatchEvent(new Event('projects-changed')); } catch(_){}
}
function saveProjects(list){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(list||[]));
    // ריענון אוטומטי בעמודים פתוחים
    notifyProjectsChanged();
  }catch(e){
    console.warn('saveProjects error:', e);
  }
}
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }
function byId(id){ return document.getElementById(id); }
function getQueryParam(name){
  try{
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }catch(_){ return null; }
}
function uuid(){
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}
function nowIso(){ return new Date().toISOString(); }
/* >>> הוספה: פורמט מטבע + ברירת מחדל 0 ₪ <<< */
function fmtCurrency(v){
  const n = parseFloat(String(v ?? '').toString().replace(/[, ]/g,''));
  if (isNaN(n)) return '0 ₪';
  try{
    return new Intl.NumberFormat('he-IL',{ style:'currency', currency:'ILS', maximumFractionDigits:0 }).format(n);
  }catch(_){
    // fallback
    return (Math.round(n)).toLocaleString('he-IL') + ' ₪';
  }
}

/* ---------- Seed demo data (first run only) ---------- */
(function ensureSeed(){
  const current = loadProjects();
  if(current && current.length) return;
  const demo = [
    {
      id: uuid(),
      year: '2025', area:'שטח רכש מנהלי', dept:'מחלקה 1', domain:'תחום א', buyer:'מוריה',
      division:'חטיבה 1', unit:'יחידה 3', supervisor:'—',
      activity:'הארכה/הגדלה', kind:'פרויקט חדש',
      subject:'בדיקה הנדסית למערכות', projStatus:'בתהליך',
      estimatePeriodic:'', planStart:'2025-01-10', planEnd:'2025-03-30',
      actualStart:'', actualEnd:'', task:'איסוף דרישות', taskOwner:'עדן', taskDue:'2025-03-15',
      taskStatus:'בתהליך', notes:'', currentOrderNo:'', currentSuppliers:'',
      currentPeriodic:'', currentAnnual:'', currentEnd:'', totalYearsCurrent:'',
      newOrderNo:'', agreementYears:'', optionYears:'', totalYears:'',
      annualEstimate:'', winnersNames:'',
      createdAt: nowIso(), updatedAt: nowIso()
    }
  ];
  saveProjects(demo);
})();

/* =======================================================
   דף 1: רשימת פרויקטים (projects.html)
   ======================================================= */
function populateFilterSelect(selectEl, values, includeAll=true){
  if(!selectEl) return;
  const sel = selectEl;
  sel.innerHTML = '';
  if(includeAll){
    const op = document.createElement('option');
    op.value = ''; op.textContent = 'הכול';
    sel.appendChild(op);
  }
  values.forEach(v=>{
    const op = document.createElement('option');
    op.value = v; op.textContent = v;
    sel.appendChild(op);
  });
}
function renderKpis(projects){
  const total = projects.length;
  const done = projects.filter(p=>p.projStatus==='הסתיים').length;
  const inprog = projects.filter(p=>p.projStatus==='בתהליך').length;
  const not = projects.filter(p=>p.projStatus==='לא התחיל').length;
  const cancel = projects.filter(p=>p.projStatus==='מבוטל').length;
  const freeze = projects.filter(p=>p.projStatus==='מוקפא').length;
  byId('kpi-total') && (byId('kpi-total').textContent = total);
  byId('kpi-done') && (byId('kpi-done').textContent = done);
  byId('kpi-in') && (byId('kpi-in').textContent = inprog);
  byId('kpi-not') && (byId('kpi-not').textContent = not);
  byId('kpi-cancel') && (byId('kpi-cancel').textContent = cancel);
  byId('kpi-freeze') && (byId('kpi-freeze').textContent = freeze);

  // פס התקדמות (אם קיים)
  const fill = byId('kpi-progress-fill');
  const label = byId('kpi-progress-pct');
  if(fill || label){
    const pct = total ? Math.round((inprog/total)*100) : 0;
    if(fill)  fill.style.width = pct + '%';
    if(label) label.textContent = pct + '%';
  }
}

/* ------- כרטיס התקדמות – לוגיקה ו־UI (דשבורד) ------- */
const COMPLETED_STATUSES = new Set(['הסתיים','מבוטל','מוקפא']);
const ACTIVITIES_ORDER = [
  'מכרז','ספק יחיד','תחרות','הארכה/הגדלה','מימוש אופציה','חשכ״ל','ניהול משבר','בדיקה הנדסית'
];
const BAR_COLORS = [
  '#b8ff7a','#6ee7ff','#a78bfa','#60a5fa','#fbbf24','#34d399','#f472b6','#94a3b8'
];

function calcProgressData(list){
  const total = list.length;
  const completed = list.filter(p=> COMPLETED_STATUSES.has(p?.projStatus)).length;
  const overallPercent = total ? Math.round((completed/total)*100) : 0;

  // קיבוץ לפי פעילות
  const counters = new Map(); // activity -> {total, done}
  function bump(act, isDone){
    const key = act || 'לא ידוע';
    const cur = counters.get(key) || { total:0, done:0 };
    cur.total += 1;
    if(isDone) cur.done += 1;
    counters.set(key, cur);
  }
  list.forEach(p=>{
    bump(p?.activity, COMPLETED_STATUSES.has(p?.projStatus));
  });

  // בניה לפי סדר קבוע + פעילויות נוספות בסוף
  const seen = new Set();
  const rows = [];
  ACTIVITIES_ORDER.forEach((name, idx)=>{
    const c = counters.get(name) || {total:0, done:0};
    rows.push({
      name,
      total: c.total,
      done: c.done,
      percent: c.total ? Math.round((c.done/c.total)*100) : 0,
      color: BAR_COLORS[idx % BAR_COLORS.length]
    });
    seen.add(name);
  });
  // פעילויות לא מוכרות
  [...counters.keys()].forEach(name=>{
    if(seen.has(name)) return;
    const c = counters.get(name);
    rows.push({
      name,
      total: c.total,
      done: c.done,
      percent: c.total ? Math.round((c.done/c.total)*100) : 0,
      color: BAR_COLORS[rows.length % BAR_COLORS.length]
    });
  });

  return { total, completed, overallPercent, rows };
}

function renderProgressPanel(list){
  const host = byId('progress-card');
  if(!host) return;

  const { overallPercent, rows } = calcProgressData(list);

  // SVG טבעת
  const SIZE = 140, STROKE = 10, R = (SIZE/2) - STROKE, C = 2*Math.PI*R;
  host.innerHTML = `
    <div class="progress-card__inner" role="region" aria-label="מד התקדמות">
      <div class="ring-wrap" aria-hidden="false">
        <svg class="ring" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
          <circle class="ring-bg" cx="${SIZE/2}" cy="${SIZE/2}" r="${R}" stroke-width="${STROKE}" />
          <circle class="ring-fg" cx="${SIZE/2}" cy="${SIZE/2}" r="${R}" stroke-width="${STROKE}"
                  style="stroke-dasharray:${C};stroke-dashoffset:${C}"/>
        </svg>
        <div class="ring-center">
          <div class="ring-percent" id="ring-percent">${overallPercent}%</div>
          <div class="ring-label">התקדמות</div>
        </div>
      </div>
      <div class="bars" id="activity-bars">
        ${rows.map((r,i)=>`
          <div class="bar-row">
            <div class="bar-head">
              <span class="bar-name">${r.name}</span>
              <span class="bar-ratio" dir="ltr">${r.done}/${r.total}</span>
            </div>
            <div class="bar-track"><i class="bar-fill" style="width:0%" data-target="${r.percent}" data-color="${r.color}"></i></div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // אנימציה עדינה: מילוי טבעת ופסים
  requestAnimationFrame(()=>{
    // טבעת
    const fg = host.querySelector('.ring-fg');
    const offset = C * (1 - (overallPercent/100));
    fg.style.strokeDashoffset = String(offset);

    // פסים
    host.querySelectorAll('.bar-fill').forEach(e  });
}

/* =======================================================
   Charts Section - New Charts for Dashboard
   ======================================================= */
let chartInstances = {};

function renderCharts(projects) {
  // Destroy existing charts to prevent memory leaks
  Object.values(chartInstances).forEach(chart => {
    if (chart) chart.destroy();
  });
  chartInstances = {};

  // Chart 1: Bar chart - Total project volume by activity
  renderVolumeByActivityChart(projects);
  
  // Chart 2: Doughnut chart - Project count by status
  renderProjectsByStatusChart(projects);
  
  // Chart 3: Line chart - Monthly project completions
  renderMonthlyCompletionsChart(projects);
}

function renderVolumeByActivityChart(projects) {
  const ctx = document.getElementById('chart-volume-by-activity');
  if (!ctx) return;

  // Group by activity and sum estimatePeriodic
  const activityTotals = {};
  projects.forEach(project => {
    const activity = project.activity || 'לא ידוע';
    const estimate = parseFloat(String(project.estimatePeriodic || '').replace(/[, ]/g, '')) || 0;
    activityTotals[activity] = (activityTotals[activity] || 0) + estimate;
  });

  const activities = Object.keys(activityTotals);
  const volumes = activities.map(activity => activityTotals[activity]);

  chartInstances.volumeByActivity = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: activities,
      datasets: [{
        label: 'היקף פרויקטים (₪)',
        data: volumes,
        backgroundColor: [
          '#b8ff7a', '#6ee7ff', '#a78bfa', '#60a5fa', 
          '#fbbf24', '#34d399', '#f472b6', '#94a3b8'
        ],
        borderColor: '#0f172a',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.label + ': ' + fmtCurrency(context.parsed.y);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return fmtCurrency(value);
            }
          }
        }
      }
    }
  });
}

function renderProjectsByStatusChart(projects) {
  const ctx = document.getElementById('chart-projects-by-status');
  if (!ctx) return;

  // Count projects by status
  const statusCounts = {};
  projects.forEach(project => {
    const status = project.projStatus || 'לא ידוע';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const statuses = Object.keys(statusCounts);
  const counts = statuses.map(status => statusCounts[status]);

  // Color mapping based on existing KPI colors
  const statusColors = {
    'הסתיים': '#d6f95c',
    'בתהליך': '#3fe1f6', 
    'לא התחיל': '#22c55e',
    'מבוטל': '#94a3b8',
    'מוקפא': '#60a5fa',
    'לא ידוע': '#6b7280'
  };

  const colors = statuses.map(status => statusColors[status] || '#6b7280');

  chartInstances.projectsByStatus = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: statuses,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 20,
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((context.parsed / total) * 100).toFixed(1);
              return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
            }
          }
        }
      }
    }
  });
}

function renderMonthlyCompletionsChart(projects) {
  const ctx = document.getElementById('chart-monthly-completions');
  if (!ctx) return;

  // Group completed projects by month
  const monthlyCompletions = {};
  const completedStatuses = ['הסתיים', 'מבוטל', 'מוקפא'];
  
  projects.forEach(project => {
    if (completedStatuses.includes(project.projStatus) && project.actualEnd) {
      try {
        const date = new Date(project.actualEnd);
        const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
        monthlyCompletions[monthKey] = (monthlyCompletions[monthKey] || 0) + 1;
      } catch (e) {
        // Skip invalid dates
      }
    }
  });

  // Sort months chronologically
  const sortedMonths = Object.keys(monthlyCompletions).sort();
  const completions = sortedMonths.map(month => monthlyCompletions[month]);
  
  // Format month labels for display
  const monthLabels = sortedMonths.map(month => {
    const [year, month] = month.split('-');
    const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                       'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return monthNames[parseInt(month) - 1] + ' ' + year;
  });

  chartInstances.monthlyCompletions = new Chart(ctx, {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [{
        label: 'פרויקטים שהושלמו',
        data: completions,
        borderColor: '#3fe1f6',
        backgroundColor: 'rgba(63, 225, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3fe1f6',
        pointBorderColor: '#0f172a',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return 'הושלמו: ' + context.parsed.y + ' פרויקטים';
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1
          }
        }
      }
    }
  });
}

/* =======================================================
   דף 1: טבלת פרויקטים
   ======================================================= */tProperty('--bar-color', color);
      el.style.width = pct + '%';
    });
  });
}

/* =======================================================
   דף 1: טבלת פרויקטים
   ======================================================= */
function renderProjectsTable(projects){
  const tbody = byId('projects-tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  projects.forEach((p,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="row-actions"><a href="new-project.html?edit=${i}" class="edit-btn">✏️</a></td>
      <td>${p.year||''}</td>
      <td>${p.area||''}</td>
      <td>${p.dept||''}</td>
      <td>${p.domain||''}</td>
      <td>${p.buyer||''}</td>
      <td>${p.division||''}</td>
      <td>${p.unit||''}</td>
      <td>${p.supervisor||''}</td>
      <td>${p.kind||''}</td>
      <td>${p.subject||''}</td>
      <td>${p.activity||''}</td>
      <td>${p.projStatus||''}</td>
      <!-- אומדן תקופתי (₪) -->
      <td>${fmtCurrency(p.estimatePeriodic)}</td>
      <td>${p.planStart||''}</td>
      <td>${p.planEnd||''}</td>
      <td>${p.actualStart||''}</td>
      <td>${p.actualEnd||''}</td>
      <td>${p.task||''}</td>
      <td>${p.taskOwner||''}</td>
      <td>${p.taskDue||''}</td>
      <td>${p.taskStatus||''}</td>
      <td>${p.notes||''}</td>
      <td>${p.currentOrderNo||''}</td>
      <td>${p.currentSuppliers||''}</td>
      <!-- היקפים נוכחיים (₪) -->
      <td>${fmtCurrency(p.currentPeriodic)}</td>
      <td>${fmtCurrency(p.currentAnnual)}</td>
      <td>${p.currentEnd||''}</td>
      <td>${p.newOrderNo||''}</td>
      <!-- הצעות זוכות (₪) -->
      <td>${fmtCurrency(p.winningPeriodic)}</td>
      <td>${fmtCurrency(p.winningAnnual)}</td>
      <td>${p.agreementYears||''}</td>
      <td>${p.optionYears||''}</td>
      <td>${p.totalYears||''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function initProjectsPage(){
  let projects = loadProjects();
  const orig = projects.slice();
  const filters = {
    area: byId('f-area'),
    year: byId('f-year'),
    dept: byId('f-dept'),
    unit: byId('f-unit'),
    buyer: byId('f-buyer'),
    activity: byId('f-activity'),
    status: byId('f-status'),
    task: byId('f-task')
  };
  populateFilterSelect(filters.area, uniq(orig.map(p=>p.area)));
  populateFilterSelect(filters.year, uniq(orig.map(p=>p.year)));
  populateFilterSelect(filters.dept, uniq(orig.map(p=>p.dept)));
  populateFilterSelect(filters.unit, uniq(orig.map(p=>p.unit)));
  populateFilterSelect(filters.buyer, uniq(orig.map(p=>p.buyer)));
  populateFilterSelect(filters.activity, uniq(orig.map(p=>p.activity)));
  populateFilterSelect(filters.status, uniq(orig.map(p=>p.projStatus)));
  populateFilterSelect(filters.task, uniq(orig.map(p=>p.taskStatus)));

  function applyFilters(){
    projects = orig.filter(p=>{
      if(filters.area?.value && p.area!==filters.area.value) return false;
      if(filters.year?.value && p.year!==filters.year.value) return false;
      if(filters.dept?.value && p.dept!==filters.dept.value) return false;
      if(filters.unit?.value && p.unit!==filters.unit.value) return false;
      if(filters.buyer?.value && p.buyer!==filters.buyer.value) return false;
      if(filters.activity?.value && p.activity!==filters.activity.value) return false;
      if(filters.status?.value && p.projStatus!==filters.status.value) return false;
      if(filters.task?.value && p.taskStatus!==filters.task.value) return false;
      return true;
    });
    renderKpis(projects);
    renderProjectsTable(projects);
  }
  Object.values(filters).forEach(sel=>{ sel && sel.addEventListener('change', applyFilters); });
  byId('btn-clear-filters')?.addEventListener('click', ()=>{
    Object.values(filters).forEach(sel=>{ if(sel) sel.value=''; });
    applyFilters();
  });
  applyFilters();
}

/* =======================================================
   דף 2: פתיחת פרויקט (new-project.html)
   ======================================================= */
function initNewProjectPage(){
  const form = byId('create-form');
  if(!form) return;
  /* ----- טאבים ----- */
  const steps = Array.from(document.querySelectorAll('.step'));
  const tabs  = Array.from(document.querySelectorAll('.wizard-tabs button'));
  function showStep(n){
    steps.forEach(s=>s.classList.add('hidden'));
    const step = form.querySelector(`.step[data-step="${n}"]`);
    step && step.classList.remove('hidden');
    tabs.forEach(b=>b.classList.remove('active'));
    const tb = document.querySelector(`.wizard-tabs button[data-step="${n}"]`);
    tb && tb.classList.add('active');
  }
  tabs.forEach(b=> b.addEventListener('click', ()=>showStep(b.dataset.step)));
  showStep(1);

  /* ----- שדות ----- */
  const year = byId('c-year');
  (function fillYears(){
    const now = new Date().getFullYear();
    const base = 2023;
    year.innerHTML = '';
    for(let y=base; y<=now+1; y++){
      const op = document.createElement('option');
      op.value = String(y); op.textContent = String(y);
      year.appendChild(op);
    }
  })();
  // Subject auto-resize
  const subject = byId('c-subject');
  function autoresize(){
    subject.style.height = 'auto';
    subject.style.height = Math.min(subject.scrollHeight, 180) + 'px';
  }
  subject?.addEventListener('input', autoresize);
  autoresize();

  // Activity logic (ניהול ההליך)
  const activity = byId('c-activity');
  const tenderOnly = Array.from(document.querySelectorAll('.only-tender'));
  const compGroupTitle = byId('group-competitive');
  const compGrid = byId('competitive-grid');
  const resultsCompTitle = byId('results-competitive');
  const resultsCompGrid = byId('results-competitive-grid');
  const tenderTypes = new Set(['מכרז','תחרות','ספק יחיד']);
  function onActivityChange(){
    const isTender = activity.value==='מכרז';
    tenderOnly.forEach(el=>el.classList.toggle('hidden', !isTender));
    const isCompetitive = tenderTypes.has(activity.value);
    compGroupTitle.classList.toggle('hidden', !isCompetitive);
    compGrid.classList.toggle('hidden', !isCompetitive);
    resultsCompTitle.classList.toggle('hidden', !isCompetitive);
    resultsCompGrid.classList.toggle('hidden', !isCompetitive);
  }
  activity?.addEventListener('change', onActivityChange);

  // Kind (המשך התקשרות) — כעת מציג בשלב 1 את פרטי ההתקשרות הנוכחית
  const kind = byId('c-kind');
  const blockCurrentTitle = byId('block-current');
  const currentGrid = byId('current-grid');
  kind?.addEventListener('change', ()=>{
    const show = kind.value==='המשך להתקשרות נוכחית';
    blockCurrentTitle.classList.toggle('hidden', !show);
    currentGrid.classList.toggle('hidden', !show);
    if(!show){
      ['c-currentOrderNo','c-suppliersCount','c-currentSuppliers','c-currentPeriodic',
       'c-totalYearsCurrent','c-currentAnnual','c-currentEnd']
      .forEach(id=>{ const el=byId(id); if(el) el.value=''; });
      byId('suppliers-list').innerHTML='';
    }
  });

  // Dynamic supplier names
  const suppliersCount = byId('c-suppliersCount');
  const suppliersList = byId('suppliers-list');
  const suppliersHidden = byId('c-currentSuppliers');
  function rebuildSuppliersInputs(){
    suppliersList.innerHTML = '';
    const n = Math.max(0, Math.min(20, parseInt(suppliersCount.value||'0',10)||0));
    if(n===0){ suppliersHidden.value=''; return; }
    const names = (suppliersHidden.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    for(let i=0;i<n;i++){
      const wrap = document.createElement('label');
      wrap.innerHTML = `שם ספק ${i+1}<input type="text" class="supplier-name" data-idx="${i}"/>`;
      suppliersList.appendChild(wrap);
      const inp = wrap.querySelector('input');
      if(names[i]) inp.value = names[i];
      inp.addEventListener('input', syncSuppliersHidden);
    }
    syncSuppliersHidden();
  }
  function syncSuppliersHidden(){
    const arr = Array.from(suppliersList.querySelectorAll('.supplier-name')).map(i=>i.value.trim()).filter(Boolean);
    suppliersHidden.value = arr.join(', ');
  }
  suppliersCount?.addEventListener('input', rebuildSuppliersInputs);

  // Winners free text
  const winnersList = byId('winners-list');
  const winnersHidden = byId('c-winnersNames');
  if(winnersList){
    winnersList.innerHTML = `<label class="wide">שמות ספקים זוכים (מופרד בפסיקים)
      <input type="text" id="winners-free" placeholder="לדוגמה: ספק א, ספק ב"/></label>`;
    byId('winners-free')?.addEventListener('input', e=> winnersHidden.value = e.target.value);
  }

  // Calculations
  const currentPeriodic = byId('c-currentPeriodic');
  const totalYearsCurrent = byId('c-totalYearsCurrent');
  const currentAnnual = byId('c-currentAnnual');
  function recalcCurrentAnnual(){
    const per = parseFloat(currentPeriodic?.value||'0')||0;
    const yrs = parseFloat(totalYearsCurrent?.value||'0')||0;
    currentAnnual.value = (per && yrs) ? String(per/yrs) : '';
  }
  [currentPeriodic,totalYearsCurrent].forEach(el=>el?.addEventListener('input', recalcCurrentAnnual));

  const estimatePeriodic = byId('c-estimatePeriodic');
  const agreementYears = byId('c-agreementYears');
  const optionYears = byId('c-optionYears');
  const totalYears = byId('c-totalYears');
  const annualEstimate = byId('c-annualEstimate');
  function recalcTenderYearsAndAnnual(){
    const a = parseFloat(agreementYears?.value||'0')||0;
    const o = parseFloat(optionYears?.value||'0')||0;
    const t = a + o;
    totalYears.value = t ? String(t) : '';
    const est = parseFloat(estimatePeriodic?.value||'0')||0;
    annualEstimate.value = (t && est) ? String(est/t) : '';
  }
  [agreementYears,optionYears,estimatePeriodic].forEach(el=>el?.addEventListener('input', recalcTenderYearsAndAnnual));

  // Results sync
  const projStatusBase = byId('c-projStatus');
  const projStatusRes = byId('c-projStatus-result');
  const actualEnd = byId('c-actualEnd');
  const actualEndMirror = byId('c-actualEnd-mirror');
  function syncProjStatusFromBase(){ if(projStatusRes) projStatusRes.value = projStatusBase.value; }
  function syncProjStatusFromRes(){ if(projStatusBase) projStatusBase.value = projStatusRes.value; }
  function syncActualEndToMirror(){ if(actualEndMirror) actualEndMirror.value = actualEnd.value; }
  function syncActualEndFromMirror(){ if(actualEnd) actualEnd.value = actualEndMirror.value; }
  projStatusBase?.addEventListener('change', syncProjStatusFromBase);
  projStatusRes?.addEventListener('change', syncProjStatusFromRes);
  actualEnd?.addEventListener('change', syncActualEndToMirror);
  actualEndMirror?.addEventListener('change', syncActualEndFromMirror);

  // Task status auto
  const taskDue = byId('c-taskDue');
  const taskStatus = byId('c-taskStatus');
  function autoTaskStatus(){
    if(!taskDue?.value){ return; }
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(taskDue.value); due.setHours(0,0,0,0);
    if(due >= today) taskStatus.value = 'בתהליך';
    else taskStatus.value = 'בחריגה';
  }
  taskDue?.addEventListener('change', autoTaskStatus);

  /* ----- עריכת תאריכי תכנון — אימות לאחר 24 שעות ----- */
  const planStart = byId('c-planStart');
  const planEnd   = byId('c-planEnd');
  const adminModal   = byId('admin-modal');
  const adminInput   = byId('admin-code');
  const adminCancel  = byId('admin-cancel');
  const adminConfirm = byId('admin-confirm');
  let protectedFields = [planStart, planEnd];
  let unlockUntilTs = 0;
  let unlockProjectKey = null;
  function isProtected(project){
    if(!project?.createdAt) return false;
    const created = new Date(project.createdAt).getTime();
    const diffHrs = (Date.now() - created) / (1000*60*60);
    return diffHrs >= LOCK_AFTER_HOURS; // 24h
  }
  function sessionKey(projId){ return SESSION_PREFIX + (projId || 'new'); }
  function isUnlockedNow(){ return Date.now() < unlockUntilTs; }
  function openAdminModal(){
    if(!adminModal) return;
    adminModal.classList.add('show');
    adminInput.value = '';
    adminInput.focus();
  }
  function closeAdminModal(){ adminModal?.classList.remove('show'); }
  adminCancel?.addEventListener('click', closeAdminModal);
  adminConfirm?.addEventListener('click', ()=>{
    const code = (adminInput.value || '').trim();
    if(code === ADMIN_CODE){
      unlockUntilTs = Date.now() + UNLOCK_WINDOW_MIN*60*1000;
      sessionStorage.setItem(unlockProjectKey, String(unlockUntilTs));
      protectedFields.forEach(inp=>{ if(inp){ inp.readOnly = false; }});
      closeAdminModal();
      protectedFields[0]?.focus();
    }else{
      adminInput.value = '';
      adminInput.focus();
    }
  });
  function attachProtectedHandlers(project){
    const projId = project?.id || 'new';
    unlockProjectKey = sessionKey(projId);
    const saved = parseInt(sessionStorage.getItem(unlockProjectKey)||'0', 10);
    unlockUntilTs = isNaN(saved) ? 0 : saved;
    const protect = isProtected(project) && !isUnlockedNow();
    protectedFields.forEach(inp=>{
      if(!inp) return;
      if(protect){
        inp.readOnly = true;
        inp.addEventListener('focus', onProtectedFocus);
        inp.addEventListener('mousedown', onProtectedMouseDown);
      }else{
        inp.readOnly = false;
        inp.removeEventListener('focus', onProtectedFocus);
        inp.removeEventListener('mousedown', onProtectedMouseDown);
      }
    });
  }
  function onProtectedFocus(e){
    if(!isUnlockedNow()){ e.target.blur(); openAdminModal(); }
  }
  function onProtectedMouseDown(e){
    if(!isUnlockedNow()){
      e.preventDefault();
      openAdminModal();
    }
  }

  /* ----- עריכה קיימת ----- */
  const editIndex = getQueryParam('edit');
  let editingProject = null;
  if(editIndex!==null){
    const p = loadProjects()[parseInt(editIndex,10)];
    if(p){
      editingProject = p;
      form.querySelectorAll('input,select,textarea').forEach(el=>{
        const key = el.id.replace(/^c-/, '');
        if(key in p && el.id!=='c-actualEnd-mirror' && el.id!=='c-projStatus-result'){
          el.value = p[key] ?? '';
        }
      });
    }
  }
  // הפעלת מצבים ראשוניים
  onActivityChange();
  kind?.dispatchEvent(new Event('change'));
  rebuildSuppliersInputs();
  recalcCurrentAnnual();
  recalcTenderYearsAndAnnual();
  syncProjStatusFromBase();
  syncActualEndToMirror();

  // הגנה על שני שדות התכנון
  attachProtectedHandlers(editingProject);

  /* ----- שמירה ----- */
  function collectFormData(){
    const data = {};
    if(typeof syncSuppliersHidden === 'function') syncSuppliersHidden();
    form.querySelectorAll('input,select,textarea').forEach(el=>{
      if(el.id==='c-actualEnd-mirror' || el.id==='c-projStatus-result') return;
      if(el.disabled) return;
      const key = el.id.replace(/^c-/, '');
      data[key] = el.value;
    });
    if(byId('c-totalYears'))     data.totalYears     = byId('c-totalYears').value || data.totalYears;
    if(byId('c-annualEstimate')) data.annualEstimate = byId('c-annualEstimate').value || data.annualEstimate;
    if(byId('c-currentAnnual'))  data.currentAnnual  = byId('c-currentAnnual').value || data.currentAnnual;

    const now = nowIso();
    if(!editingProject){
      data.id = uuid();
      data.createdAt = now;
    }else{
      data.id = editingProject.id;
      data.createdAt = editingProject.createdAt || now;
    }
    data.updatedAt = now;
    if(!data.projStatus) data.projStatus = editingProject?.projStatus || 'בתהליך';
    return data;
  }
  function validateMinimum(){
    const a = (byId('c-planStart')?.value||'').trim();
    const b = (byId('c-planEnd')?.value||'').trim();
    const missing = [];
    if(!a) missing.push('מועד התחלה מתוכנן');
    if(!b) missing.push('מועד סיום מתוכנן');
    if(missing.length){
      [byId('c-planStart'), byId('c-planEnd')].forEach(el=>{
        if(el && !el.value) el.classList.add('shake');
        setTimeout(()=> el?.classList.remove('shake'), 600);
      });
      alert('יש להשלים: ' + missing.join(', '));
      return false;
    }
    if(a && b){
      const da = new Date(a).getTime();
      const db = new Date(b).getTime();
      if(db < da){
        alert('מועד סיום מתוכנן לא יכול להיות לפני מועד התחלה מתוכנן.');
        return false;
      }
    }
    return true;
  }
  byId('saveProject')?.addEventListener('click', e=>{
    e.preventDefault();
    if(!validateMinimum()) return;
    const data = collectFormData();
    const projects = loadProjects();
    const editIndex = getQueryParam('edit');
    if(editIndex!==null){
      projects[parseInt(editIndex,10)] = {...projects[parseInt(editIndex,10)], ...data};
    }else{
      projects.push(data);
    }
    saveProjects(projects);
    if(!editingProject) editingProject = data;
    attachProtectedHandlers(editingProject);
    alert('נשמר בהצלחה ✅');
    window.location.href = 'projects.html';
  });
}

/* =======================================================
   דף 3: הדשבורד — אותם מסננים וריבועי KPI כמו בעמוד הפרויקטים
   ======================================================= */
function initDashboard(){
  let projects = loadProjects();
  let orig = projects.slice();

  // ⚠️ יישור מלא: אותם מסננים בדיוק כמו ב-projects.html
  const filters = {
    year:     byId('f-year'),
    area:     byId('f-area'),
    dept:     byId('f-dept'),
    unit:     byId('f-unit'),
    buyer:    byId('f-buyer'),
    activity: byId('f-activity'),
    status:   byId('f-status'),
    task:     byId('f-task')
  };
  function hydrateFilters(base){
    populateFilterSelect(filters.year,     uniq(base.map(p=>p.year)));
    populateFilterSelect(filters.area,     uniq(base.map(p=>p.area)));
    populateFilterSelect(filters.dept,     uniq(base.map(p=>p.dept)));
    populateFilterSelect(filters.unit,     uniq(base.map(p=>p.unit)));
    populateFilterSelect(filters.buyer,    uniq(base.map(p=>p.buyer)));
    populateFilterSelect(filters.activity, uniq(base.map(p=>p.activity)));
    populateFilterSelect(filters.status,   uniq(base.map(p=>p.projStatus)));
    populateFilterSelect(filters.task,     uniq(base.map(p=>p.taskStatus)));
  }

  function applyFilters(){
    const list = orig.filter(p=>{    renderKpis(list);
    renderProgressPanel(list); // <<< חדש: עדכון הכרטיס
    renderCharts(list); // <<< חדש: עדכון הגרפים
  }      if(filters.area?.value     && p.area!==filters.area.value) return false;
      if(filters.dept?.value     && p.dept!==filters.dept.value) return false;
      if(filters.unit?.value     && p.unit!==filters.unit.value) return false;
      if(filters.buyer?.value    && p.buyer!==filters.buyer.value) return false;
      if(filters.activity?.value && p.activity!==filters.activity.value) return false;
      if(filters.status?.value   && p.projStatus!==filters.status.value) return false;
      if(filters.task?.value     && p.taskStatus!==filters.task.value) return false;
      return true;
    });
    renderKpis(list);
    renderProgressPanel(list); // <<< חדש: עדכון הכרטיס
  }

  Object.values(filters).forEach(sel=> sel && sel.addEventListener('change', applyFilters));
  byId('btn-clear-filters')?.addEventListener('click', ()=>{
    Object.values(filters).forEach(sel=>{ if(sel) sel.value=''; });
    applyFilters();
  });

  // רענון אוטומטי כשדאטה משתנה (שמירה/עריכה) + מטאבים אחרים
  function reloadPreserveSelections(){
    const keep = {
      year:     filters.year?.value || '',
      area:     filters.area?.value || '',
      dept:     filters.dept?.value || '',
      unit:     filters.unit?.value || '',
      buyer:    filters.buyer?.value || '',
      activity: filters.activity?.value || '',
      status:   filters.status?.value || '',
      task:     filters.task?.value || ''
    };
    projects = loadProjects();
    orig = projects.slice();
    hydrateFilters(orig);
    if(filters.year)     filters.year.value     = keep.year;
    if(filters.area)     filters.area.value     = keep.area;
    if(filters.dept)     filters.dept.value     = keep.dept;
    if(filters.unit)     filters.unit.value     = keep.unit;
    if(filters.buyer)    filters.buyer.value    = keep.buyer;
    if(filters.activity) filters.activity.value = keep.activity;
    if(filters.status)   filters.status.value   = keep.status;
    if(filters.task)     filters.task.value     = keep.task;
    applyFilters();
  }
  window.addEventListener('projects-changed', reloadPreserveSelections);
  window.addEventListener('storage', (e)=>{ if(e.key===LS_KEY) reloadPreserveSelections(); });

  // התחלה
  hydrateFilters(orig);
  applyFilters();
}

/* =======================================================
   Init לכל עמוד לפי מזהה ה-root
   ======================================================= */
document.addEventListener('DOMContentLoaded', ()=>{
  if (byId('projects-page'))    initProjectsPage();
  if (byId('new-project-page')) initNewProjectPage();
  if (byId('dashboard-page'))   initDashboard();
});