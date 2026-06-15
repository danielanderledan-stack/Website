/* ============================================================
   Tradie CRM — router, views, interactions. Frontend mock.
   ============================================================ */
(function () {
  const D = window.DB, Ch = window.Charts;
  const COL = {
    success: 'hsl(142 71% 38%)', warning: 'hsl(38 92% 50%)', danger: 'hsl(0 72% 51%)',
    info: 'hsl(199 89% 48%)', violet: 'hsl(262 83% 58%)',
  };
  const $ = (s, r = document) => r.querySelector(s);
  const fmt = D.fmt;
  const state = { view: 'home', leadsView: 'list', jobsView: 'calendar', setupTab: 'details' };
  var CRM_openLead, CRM_openJob, CRM_openClient, CRM_openQuoteBuilder;

  const TITLES = {
    home: ['Home', 'Friday, 15 June'],
    leads: ['Leads', 'New enquiries — add and track them'],
    quotes: ['Quotes', 'Build, send and track your quotes'],
    jobs: ['Jobs', 'Your schedule and job cards'],
    clients: ['Clients', 'Everyone you’ve worked with'],
    money: ['Money', 'Invoices, what’s paid and what’s owed'],
    chatbot: ['Website Assistant', 'Ask for any change to your website'],
    stats: ['Website Stats', 'How your site is performing'],
    setup: ['Setup', 'Your business details and branding'],
    help: ['Help', 'Guides and support'],
  };

  /* ---------------- shared bits ---------------- */
  const stageCls = { New: 'b-info', Contacted: 'b-violet', Quoted: 'b-warning', Won: 'b-success', Lost: 'b-danger' };
  const qCls = { Draft: 'b-muted', Sent: 'b-info', Accepted: 'b-success', Lost: 'b-danger' };
  const invCls = { Paid: 'b-success', Unpaid: 'b-warning', Overdue: 'b-danger' };
  const jobCls = { booked: 'b-info', onsite: 'b-warning', done: 'b-success' };
  const jobLabel = { booked: 'Booked', onsite: 'On site', done: 'Done' };
  const pill = (txt, cls) => `<span class="badge ${cls}"><span class="dot"></span>${txt}</span>`;

  function card(title, sub, body, extra = '') {
    return `<div class="card ${extra}">
      ${title ? `<div class="card-pad pb-3 flex items-center justify-between"><div><div class="card-title">${title}</div>${sub ? `<div class="card-sub mt-0.5">${sub}</div>` : ''}</div></div>` : ''}
      ${body}
    </div>`;
  }

  /* ===================== HOME ===================== */
  function home() {
    const paid = D.invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + i.amount, 0);
    const owed = D.invoices.filter(i => i.status !== 'Paid').reduce((s, i) => s + i.amount, 0);
    const owedCount = D.invoices.filter(i => i.status !== 'Paid').length;
    const activeLeads = D.leads.filter(l => ['New', 'Contacted', 'Quoted'].includes(l.stage)).length;
    const quotesOut = D.quotes.filter(q => q.status === 'Sent').reduce((s, q) => s + q.total, 0);

    const kpi = (label, val, delta, deltaTxt, color, icon, spark) => `
      <div class="card kpi card-pad">
        <div class="flex items-start justify-between">
          <div class="min-w-0">
            <p class="card-sub uppercase tracking-wide text-[11px]">${label}</p>
            <p class="kpi-val mt-1.5">${val}</p>
            ${delta != null ? `<p class="text-xs mt-1.5 flex items-center gap-1 ${delta >= 0 ? 'delta-up' : 'delta-down'}">
              <i data-lucide="${delta >= 0 ? 'trending-up' : 'trending-down'}" class="size-3.5"></i> ${Math.abs(delta)}% ${deltaTxt}</p>` : `<p class="text-xs mt-1.5 text-muted-foreground">${deltaTxt}</p>`}
          </div>
          <span class="kpi-ico" style="background:${color}/.12 ;background:color-mix(in srgb, ${color} 12%, white);color:${color}"><i data-lucide="${icon}" class="size-[18px]"></i></span>
        </div>
        <div class="mt-3 -mb-1">${spark}</div>
      </div>`;

    const kpis = `<div class="grid grid-cols-4 gap-4">
      ${kpi('Earned (Jun)', fmt(paid), 12, 'vs May', COL.success, 'dollar-sign', Ch.sparkline(D.revenueSeries, COL.success, 200, 36))}
      ${kpi('Owed', fmt(owed), null, owedCount + ' invoices outstanding', COL.warning, 'hourglass', Ch.sparkline([2,3,2,4,3,5,4,owedCount], COL.warning, 200, 36))}
      ${kpi('New leads', activeLeads, null, 'in your pipeline', COL.info, 'inbox', Ch.sparkline([1,2,1,3,2,4,3,activeLeads], COL.info, 200, 36))}
      ${kpi('Site visits', D.stats.visits, D.stats.visitsDelta, 'vs last week', COL.violet, 'mouse-pointer-click', Ch.sparkline(D.visitsSeries, COL.violet, 200, 36))}
    </div>`;

    // funnel
    const stages = [
      { k: 'New', n: D.leads.filter(l => l.stage === 'New').length, c: COL.info },
      { k: 'Contacted', n: D.leads.filter(l => l.stage === 'Contacted').length, c: COL.violet },
      { k: 'Quoted', n: D.leads.filter(l => l.stage === 'Quoted').length, c: COL.warning },
      { k: 'Won', n: D.leads.filter(l => l.stage === 'Won').length, c: COL.success },
    ];
    const fmax = Math.max(...stages.map(s => s.n)) || 1;
    const funnel = stages.map(s => `
      <div class="flex items-center gap-3 text-[13px]">
        <span class="w-20 shrink-0">${s.k}</span>
        <div class="flex-1 h-5 rounded bg-muted overflow-hidden"><div class="h-full rounded" style="width:${(s.n/fmax)*100}%;background:${s.c}"></div></div>
        <span class="w-5 text-right font-semibold tabular-nums">${s.n}</span>
      </div>`).join('');

    const chartCard = card('Money &amp; traffic', 'Last 30 days',
      `<div class="card-pad pt-1">
        <div class="flex items-center gap-4 text-xs mb-2">
          <span class="flex items-center gap-1.5"><span class="w-3 h-[3px] rounded" style="background:${COL.success}"></span>Revenue</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-[3px] rounded" style="background:${COL.violet};opacity:.9"></span>Site visits</span>
        </div>
        ${Ch.area2(D.revenueSeries, D.visitsSeries, COL.success, COL.violet)}
      </div>`, 'col-span-8');

    const pipelineCard = card('Pipeline', 'Where your work is',
      `<div class="card-pad pt-1">
        <div class="flex justify-center mb-3">${Ch.radial(50, 'win rate', COL.success, 132)}</div>
        <div class="space-y-2">${funnel}</div>
        <div class="mt-4 pt-3 border-t flex items-center justify-between text-[13px]">
          <span class="text-muted-foreground">Quotes out</span><span class="font-semibold">${fmt(quotesOut)}</span>
        </div>
      </div>`, 'col-span-4');

    // week strip
    const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dates = [11, 12, 13, 14, 15, 16, 17];
    const week = dows.map((d, i) => {
      const dayNum = i + 1;
      const js = D.jobs.filter(j => j.day === dayNum);
      const isToday = dates[i] === 15;
      return `<div class="weekday ${isToday ? 'today' : ''}">
        <div class="wd-h"><span>${d}</span><span>${dates[i]}</span></div>
        ${js.map(j => `<span class="chip chip-${j.status}" onclick="CRM.openJob('${j.id}')">${j.time} ${j.title}</span>`).join('')}
      </div>`;
    }).join('');
    const weekCard = card('This week', 'Mon 11 – Sun 17 June',
      `<div class="card-pad pt-1"><div class="grid grid-cols-7 gap-2">${week}</div></div>`, 'col-span-8');

    // up next + todo + recent leads
    const upcoming = D.jobs.filter(j => j.status !== 'done').slice(0, 3);
    const upNext = upcoming.map(j => `
      <div class="flex items-center gap-3 py-2">
        <span class="size-9 shrink-0 grid place-items-center rounded-md bg-muted text-[12px] font-semibold">${j.time}</span>
        <div class="min-w-0"><div class="text-[13px] font-medium truncate">${j.title}</div><div class="text-xs text-muted-foreground truncate">${j.client} · ${j.suburb}</div></div>
        ${pill(jobLabel[j.status], jobCls[j.status])}
      </div>`).join('');
    const todoList = D.todos.map((t, i) => `
      <label class="flex items-center gap-2.5 py-1.5 text-[13px] cursor-pointer">
        <input type="checkbox" ${t.done ? 'checked' : ''} onchange="CRM.toggleTodo(${i})" class="size-4 accent-[hsl(var(--primary))]">
        <span class="${t.done ? 'line-through text-muted-foreground' : ''} flex-1">${t.t}</span>
        <span class="text-[11px] text-muted-foreground">${t.due}</span>
      </label>`).join('');
    const recent = D.leads.slice(0, 2).map(l => `
      <div class="flex items-center gap-2.5 py-1.5">
        <span class="size-2 rounded-full" style="background:${COL.info}"></span>
        <div class="min-w-0 flex-1"><span class="text-[13px] font-medium">${l.name}</span> <span class="text-xs text-muted-foreground">· ${l.suburb}</span><div class="text-xs text-muted-foreground truncate">${l.job}</div></div>
      </div>`).join('');
    const sideCard = card('Up next', '',
      `<div class="card-pad pt-1">
        <div class="divide-y">${upNext}</div>
        <div class="mt-3 pt-3 border-t"><p class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">To-do</p>${todoList}</div>
        <div class="mt-3 pt-3 border-t"><p class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Recent leads</p>${recent}</div>
      </div>`, 'col-span-4');

    return `<div class="space-y-4 fade-in max-w-[1200px]">
      ${kpis}
      <div class="grid grid-cols-12 gap-4">${chartCard}${pipelineCard}</div>
      <div class="grid grid-cols-12 gap-4">${weekCard}${sideCard}</div>
    </div>`;
  }

  /* ===================== LEADS ===================== */
  function leads() {
    const toggle = `<div class="seg">
      <button class="${state.leadsView === 'list' ? 'on' : ''}" onclick="CRM.setLeadsView('list')">List</button>
      <button class="${state.leadsView === 'pipeline' ? 'on' : ''}" onclick="CRM.setLeadsView('pipeline')">Pipeline</button>
    </div>`;
    const head = `<div class="flex items-center justify-between mb-4">
      ${toggle}
      <button class="btn-primary" onclick="CRM.toast('Add-lead form (mock)')"><i data-lucide="plus" class="size-4"></i> Add lead</button>
    </div>`;

    if (state.leadsView === 'pipeline') {
      const cols = [
        { k: 'New', c: COL.info }, { k: 'Contacted', c: COL.violet }, { k: 'Quoted', c: COL.warning },
        { k: 'Won', c: COL.success }, { k: 'Lost', c: COL.danger },
      ];
      const board = cols.map(col => {
        const items = D.leads.filter(l => l.stage === col.k);
        return `<div class="kan-col" data-stage="${col.k}">
          <div class="kan-head"><span class="size-2 rounded-full" style="background:${col.c}"></span>${col.k}<span class="cnt">${items.length}</span></div>
          ${items.map(l => `<div class="kan-card" draggable="true" data-id="${l.id}" onclick="CRM.openLead('${l.id}')">
            <div class="text-[13px] font-medium">${l.name}</div>
            <div class="text-xs text-muted-foreground mt-0.5 line-clamp-2">${l.job}</div>
            <div class="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
              <span>${l.suburb}</span>${l.value ? `<span class="font-semibold text-foreground">${fmt(l.value)}</span>` : `<span>${l.date}</span>`}
            </div>
          </div>`).join('')}
        </div>`;
      }).join('');
      return `<div class="fade-in">${head}<div class="kanban">${board}</div>
        <p class="text-xs text-muted-foreground mt-3">Tip: drag a card between columns to move it along.</p></div>`;
    }

    const rows = D.leads.map(l => `<tr onclick="CRM.openLead('${l.id}')">
      <td><div class="font-medium">${l.name}</div><div class="text-xs text-muted-foreground">${l.phone}</div></td>
      <td class="max-w-[280px]"><div class="truncate">${l.job}</div></td>
      <td>${l.suburb}</td>
      <td><span class="text-xs text-muted-foreground">${l.source}</span></td>
      <td>${pill(l.stage, stageCls[l.stage])}</td>
      <td class="text-muted-foreground">${l.date}</td>
      <td class="text-right"><span class="row-actions inline-flex gap-1">
        <button class="btn-ghost h-8 px-2" onclick="event.stopPropagation();CRM.toast('Convert to quote (mock)')"><i data-lucide='file-text' class='size-3.5'></i></button>
      </span></td>
    </tr>`).join('');
    return `<div class="fade-in">${head}${card('', '',
      `<table class="tbl"><thead><tr><th>Name</th><th>Job needed</th><th>Suburb</th><th>Source</th><th>Stage</th><th>Added</th><th></th></tr></thead><tbody>${rows}</tbody></table>`)}</div>`;
  }

  /* ===================== QUOTES ===================== */
  function quotes() {
    const head = `<div class="flex items-center justify-between mb-4">
      <p class="text-sm text-muted-foreground">${D.quotes.length} quotes</p>
      <button class="btn-primary" onclick="CRM.openQuoteBuilder()"><i data-lucide="plus" class="size-4"></i> New quote</button>
    </div>`;
    const rows = D.quotes.map(q => `<tr onclick="CRM.openQuoteBuilder('${q.id}')">
      <td class="font-mono text-xs text-muted-foreground">${q.id}</td>
      <td><div class="font-medium">${q.client}</div><div class="text-xs text-muted-foreground">${q.suburb}</div></td>
      <td class="font-semibold tabular-nums">${fmt(q.total)}</td>
      <td>${pill(q.status, qCls[q.status])}</td>
      <td class="text-muted-foreground">${q.date}</td>
    </tr>`).join('');
    return `<div class="fade-in">${head}${card('', '',
      `<table class="tbl"><thead><tr><th>Quote</th><th>Client</th><th>Total</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`)}</div>`;
  }

  /* ===================== JOBS ===================== */
  function jobs() {
    const toggle = `<div class="seg">
      <button class="${state.jobsView === 'calendar' ? 'on' : ''}" onclick="CRM.setJobsView('calendar')">Calendar</button>
      <button class="${state.jobsView === 'list' ? 'on' : ''}" onclick="CRM.setJobsView('list')">List</button>
    </div>`;
    const head = `<div class="flex items-center justify-between mb-4">${toggle}
      <button class="btn-primary" onclick="CRM.toast('New job (mock)')"><i data-lucide="plus" class="size-4"></i> New job</button></div>`;

    if (state.jobsView === 'list') {
      const rows = D.jobs.map(j => `<tr onclick="CRM.openJob('${j.id}')">
        <td><div class="font-medium">${j.title}</div><div class="text-xs text-muted-foreground">${j.id}</div></td>
        <td>${j.client}</td><td>${j.suburb}</td>
        <td class="text-muted-foreground">${['','Mon 11','Tue 12','Wed 13','Thu 14','Fri 15'][j.day]} · ${j.time}</td>
        <td class="font-semibold tabular-nums">${fmt(j.value)}</td>
        <td>${pill(jobLabel[j.status], jobCls[j.status])}</td>
      </tr>`).join('');
      return `<div class="fade-in">${head}${card('', '',
        `<table class="tbl"><thead><tr><th>Job</th><th>Client</th><th>Suburb</th><th>When</th><th>Value</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`)}</div>`;
    }

    // month calendar (June 2026)
    const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const first = new Date(2026, 5, 1);
    let startDow = (first.getDay() + 6) % 7; // make Monday=0
    const daysInMonth = 30;
    const jobByDom = {};
    D.jobs.forEach(j => { const dom = 10 + j.day; (jobByDom[dom] = jobByDom[dom] || []).push(j); });
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell dim"></div>`;
    for (let dom = 1; dom <= daysInMonth; dom++) {
      const js = jobByDom[dom] || [];
      cells += `<div class="cal-cell ${dom === 15 ? 'today' : ''}">
        <div class="cal-date">${dom}</div>
        ${js.map(j => `<span class="chip chip-${j.status}" onclick="CRM.openJob('${j.id}')">${j.time} ${j.title}</span>`).join('')}
      </div>`;
    }
    const total = startDow + daysInMonth;
    for (let i = total; i % 7 !== 0; i++) cells += `<div class="cal-cell dim"></div>`;
    const legend = `<div class="flex items-center gap-4 text-xs mt-3 text-muted-foreground">
      <span class="flex items-center gap-1.5"><span class="w-3 h-2 rounded-sm" style="background:${COL.info}"></span>Booked</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-2 rounded-sm" style="background:${COL.warning}"></span>On site</span>
      <span class="flex items-center gap-1.5"><span class="w-3 h-2 rounded-sm" style="background:${COL.success}"></span>Done</span></div>`;
    return `<div class="fade-in">${head}
      <div class="flex items-center justify-between mb-2"><h3 class="font-semibold">June 2026</h3>
        <div class="flex gap-1"><button class="btn-ghost size-8 px-0 justify-center"><i data-lucide="chevron-left" class="size-4"></i></button>
        <button class="btn-ghost size-8 px-0 justify-center"><i data-lucide="chevron-right" class="size-4"></i></button></div></div>
      <div class="cal">${dows.map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>${legend}</div>`;
  }

  /* ===================== MONEY ===================== */
  function money() {
    const paid = D.invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + i.amount, 0);
    const unpaid = D.invoices.filter(i => i.status === 'Unpaid').reduce((s, i) => s + i.amount, 0);
    const overdue = D.invoices.filter(i => i.status === 'Overdue').reduce((s, i) => s + i.amount, 0);
    const mini = (label, val, color, icon) => `<div class="card kpi card-pad">
      <div class="flex items-start justify-between"><div><p class="card-sub uppercase text-[11px] tracking-wide">${label}</p><p class="kpi-val mt-1.5">${fmt(val)}</p></div>
      <span class="kpi-ico" style="background:color-mix(in srgb, ${color} 12%, white);color:${color}"><i data-lucide="${icon}" class="size-[18px]"></i></span></div></div>`;
    const kpis = `<div class="grid grid-cols-3 gap-4">
      ${mini('Earned this month', paid, COL.success, 'check-circle-2')}
      ${mini('Owed to you', unpaid, COL.warning, 'hourglass')}
      ${mini('Overdue', overdue, COL.danger, 'alert-triangle')}</div>`;
    const rows = D.invoices.map(inv => `<tr>
      <td class="font-mono text-xs text-muted-foreground">${inv.id}</td>
      <td class="font-medium">${inv.client}</td>
      <td class="font-semibold tabular-nums">${fmt(inv.amount)}</td>
      <td>${pill(inv.status, invCls[inv.status])}</td>
      <td class="text-muted-foreground">${inv.due}</td>
      <td class="text-right">${inv.status !== 'Paid'
        ? `<button class="btn-ghost h-8" onclick="CRM.markPaid('${inv.id}')"><i data-lucide="check" class="size-3.5"></i> Mark paid</button>`
        : `<span class="text-xs text-muted-foreground">Paid</span>`}</td>
    </tr>`).join('');
    const table = card('Invoices', '', `<table class="tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>${rows}</tbody></table>`);
    const chart = card('Revenue by month', 'Last 6 months', `<div class="card-pad pt-1">${Ch.bars(D.monthRevenue, COL.success)}</div>`);
    return `<div class="space-y-4 fade-in max-w-[1200px]">${kpis}
      <div class="grid grid-cols-12 gap-4"><div class="col-span-7">${table}</div><div class="col-span-5">${chart}</div></div></div>`;
  }

  /* ===================== CLIENTS ===================== */
  function clients() {
    const rows = D.clients.map(c => `<tr onclick="CRM.openClient('${c.id}')">
      <td><div class="font-medium">${c.name}</div></td>
      <td class="text-muted-foreground">${c.phone}</td>
      <td>${c.suburb}</td>
      <td class="text-center tabular-nums">${c.jobs}</td>
      <td class="font-semibold tabular-nums">${fmt(c.spent)}</td>
      <td class="text-muted-foreground">${c.last}</td>
    </tr>`).join('');
    return `<div class="fade-in">${card('', '',
      `<table class="tbl"><thead><tr><th>Client</th><th>Phone</th><th>Suburb</th><th class="text-center">Jobs</th><th>Total spent</th><th>Last job</th></tr></thead><tbody>${rows}</tbody></table>`)}</div>`;
  }

  /* ===================== CHATBOT (standalone) ===================== */
  function chatbot() {
    const presets = ['Change my colours', 'Update my opening hours', 'Add a special offer', 'Swap my hero photo', 'Fix some wording'];
    const thread = D.chat.map(m => `
      <div class="flex ${m.from === 'me' ? 'justify-end' : 'justify-start'} gap-2">
        ${m.from === 'bot' ? `<span class="size-7 shrink-0 grid place-items-center rounded-full bg-primary text-primary-foreground"><i data-lucide="sparkles" class="size-4"></i></span>` : ''}
        <div class="bubble ${m.from === 'me' ? 'bubble-me' : 'bubble-bot'}">${m.text}</div>
      </div>`).join('');
    return `<div class="fade-in" style="height:calc(100vh - 7rem)">
      <div class="grid grid-cols-12 gap-4 h-full">
        <div class="col-span-8 card flex flex-col overflow-hidden">
          <div id="chatThread" class="flex-1 overflow-y-auto p-5 space-y-4">${thread}</div>
          <div class="border-t p-3">
            <div class="flex gap-2 mb-2 overflow-x-auto pb-1">${presets.map(p => `<button class="preset-chip" onclick="CRM.preset('${p}')">${p}</button>`).join('')}</div>
            <div class="flex items-end gap-2">
              <button class="btn-ghost size-[42px] px-0 justify-center shrink-0" onclick="CRM.toast('Attach photo (mock)')"><i data-lucide="paperclip" class="size-4"></i></button>
              <textarea id="chatInput" class="in" rows="1" placeholder="Tell me what to change…" onkeydown="CRM.chatKey(event)"></textarea>
              <button class="btn-primary size-[42px] px-0 justify-center shrink-0" onclick="CRM.send()"><i data-lucide="send" class="size-4"></i></button>
            </div>
          </div>
        </div>
        <div class="col-span-4 space-y-4">
          ${card('Your website', 'Live preview',
            `<div class="card-pad pt-1"><div class="rounded-lg border overflow-hidden bg-muted aspect-[4/3] grid place-items-center text-muted-foreground">
              <div class="text-center"><i data-lucide="globe" class="size-7 mx-auto mb-2 opacity-60"></i><div class="text-xs">sparkydan.com.au</div></div>
            </div><a class="btn-ghost w-full mt-3 justify-center" onclick="CRM.toast('Opens your live site')"><i data-lucide="external-link" class="size-3.5"></i> Open site</a></div>`)}
          ${card('Recent changes', '',
            `<div class="card-pad pt-1 text-[13px] space-y-2.5">
              <div class="flex gap-2"><i data-lucide="check" class="size-4 text-success mt-0.5"></i><div><div>Updated opening hours</div><div class="text-xs text-muted-foreground">2 days ago</div></div></div>
              <div class="flex gap-2"><i data-lucide="check" class="size-4 text-success mt-0.5"></i><div><div>Added winter safety-check offer</div><div class="text-xs text-muted-foreground">5 days ago</div></div></div>
            </div>`)}
        </div>
      </div></div>`;
  }

  /* ===================== STATS ===================== */
  function stats() {
    const s = D.stats;
    const mini = (label, val, color, icon, delta) => `<div class="card kpi card-pad">
      <div class="flex items-start justify-between"><div><p class="card-sub uppercase text-[11px] tracking-wide">${label}</p><p class="kpi-val mt-1.5">${val}</p>
      ${delta != null ? `<p class="text-xs mt-1.5 delta-up flex items-center gap-1"><i data-lucide="trending-up" class="size-3.5"></i> ${delta}%</p>` : ''}</div>
      <span class="kpi-ico" style="background:color-mix(in srgb, ${color} 12%, white);color:${color}"><i data-lucide="${icon}" class="size-[18px]"></i></span></div></div>`;
    const kpis = `<div class="grid grid-cols-4 gap-4">
      ${mini('Visits (7d)', s.visits, COL.violet, 'mouse-pointer-click', s.visitsDelta)}
      ${mini('Unique visitors', s.unique, COL.info, 'user')}
      ${mini('Contact clicks', s.contactClicks, COL.success, 'phone-call')}
      ${mini('Calls tapped', s.calls, COL.warning, 'phone')}</div>`;
    const traffic = card('Visits over time', 'Last 30 days', `<div class="card-pad pt-1">${Ch.area2(D.visitsSeries, D.visitsSeries.map(v => v * .6), COL.violet, COL.info)}</div>`, 'col-span-8');
    const sources = card('Traffic sources', '',
      `<div class="card-pad pt-1 flex items-center gap-4">
        <div>${Ch.donut(s.sources)}</div>
        <div class="space-y-2 text-[13px]">${s.sources.map(x => `<div class="flex items-center gap-2"><span class="size-2.5 rounded-full" style="background:${x.c.startsWith('var') ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue(x.c.slice(4, -1))})` : x.c}"></span>${x.s}<span class="text-muted-foreground ml-auto pl-3">${x.v}</span></div>`).join('')}</div>
      </div>`, 'col-span-4');
    const top = card('Top pages', '', `<div class="card-pad pt-1">${Ch.hbars(s.topPages, COL.info)}</div>`);
    return `<div class="space-y-4 fade-in max-w-[1200px]">${kpis}
      <div class="grid grid-cols-12 gap-4">${traffic}${sources}</div>${top}</div>`;
  }

  /* ===================== SETUP ===================== */
  function setup() {
    const b = D.business;
    const tab = (k, label) => `<button class="${state.setupTab === k ? 'on' : ''}" onclick="CRM.setSetupTab('${k}')">${label}</button>`;
    const tabs = `<div class="seg mb-4">${tab('details', 'Business details')}${tab('branding', 'Branding')}${tab('account', 'Account')}</div>`;
    const field = (lbl, val) => `<div><label class="lbl">${lbl}</label><input class="in" value="${val}"></div>`;
    let body = '';
    if (state.setupTab === 'details') {
      body = `<div class="grid grid-cols-2 gap-4">
        ${field('Business name', b.name)}${field('Owner', b.owner)}
        ${field('Phone', b.phone)}${field('Email', b.email)}
        ${field('Street address', b.address)}${field('Suburb', b.suburb)}
        ${field('ABN', b.abn)}${field('Opening hours', b.hours)}
      </div>
      <p class="text-xs text-muted-foreground mt-4"><i data-lucide="info" class="size-3.5 inline -mt-0.5"></i> These details fill your quotes, invoices and website automatically.</p>`;
    } else if (state.setupTab === 'branding') {
      body = `<div class="grid grid-cols-2 gap-4">
        <div><label class="lbl">Main colour</label><div class="flex gap-2"><input type="color" value="${b.primary}" class="h-[38px] w-[52px] rounded-md border"><input class="in" value="${b.primary}"></div><p class="text-xs text-muted-foreground mt-1">Buttons &amp; highlights</p></div>
        <div><label class="lbl">Dark colour</label><div class="flex gap-2"><input type="color" value="${b.dark}" class="h-[38px] w-[52px] rounded-md border"><input class="in" value="${b.dark}"></div><p class="text-xs text-muted-foreground mt-1">Menu bar &amp; footer</p></div>
        <div><label class="lbl">Logo</label><div class="border-2 border-dashed rounded-md h-[80px] grid place-items-center text-muted-foreground text-xs cursor-pointer hover:bg-muted/40"><span><i data-lucide="upload" class="size-4 inline -mt-0.5"></i> Upload logo</span></div></div>
        <div><label class="lbl">Heading font</label><select class="in"><option>Inter</option><option>Poppins</option><option>Montserrat</option></select></div>
      </div>`;
    } else {
      body = `<div class="grid grid-cols-2 gap-4">${field('Login email', b.email)}${field('Plan', 'Tradie · $39/mo')}</div>
        <button class="btn-ghost mt-4"><i data-lucide="log-out" class="size-3.5"></i> Log out</button>`;
    }
    return `<div class="fade-in max-w-[760px]">${tabs}${card('', '', `<div class="card-pad">${body}<div class="mt-5 pt-4 border-t flex justify-end"><button class="btn-primary" onclick="CRM.toast('Saved (mock)')">Save changes</button></div></div>`)}</div>`;
  }

  function help() {
    const items = [['book-open', 'Getting started', 'Set up your business details and add your first lead'],
      ['file-text', 'Sending a quote', 'Build a quote from your price list in under a minute'],
      ['dollar-sign', 'Getting paid', 'Turn a quote into an invoice and mark it paid'],
      ['sparkles', 'Changing your website', 'Just ask the assistant — colours, hours, photos, offers']];
    return `<div class="fade-in max-w-[760px] grid grid-cols-2 gap-4">
      ${items.map(([i, t, d]) => `<div class="card card-pad hover:border-primary/50 cursor-pointer" onclick="CRM.toast('Guide (mock)')">
        <span class="kpi-ico mb-3" style="background:color-mix(in srgb, ${COL.info} 12%, white);color:${COL.info}"><i data-lucide="${i}" class="size-[18px]"></i></span>
        <div class="card-title">${t}</div><p class="card-sub mt-1">${d}</p></div>`).join('')}
      <div class="card card-pad col-span-2 flex items-center gap-4">
        <span class="kpi-ico" style="background:color-mix(in srgb, ${COL.success} 12%, white);color:${COL.success}"><i data-lucide="phone" class="size-[18px]"></i></span>
        <div class="flex-1"><div class="card-title">Stuck? Call Dan</div><p class="card-sub">Real human help on 0432 839 654 — questions are always free.</p></div></div>
    </div>`;
  }

  const VIEWS = { home, leads, quotes, jobs, clients, money, chatbot, stats, setup, help };

  /* ===================== SHEETS ===================== */
  function sheetHeader(title, sub) {
    return `<div class="sticky top-0 bg-background border-b px-5 h-16 flex items-center gap-3 z-10">
      <button class="btn-ghost size-9 px-0 justify-center" onclick="CRM.closeSheet()"><i data-lucide="x" class="size-4"></i></button>
      <div><div class="font-semibold">${title}</div>${sub ? `<div class="text-xs text-muted-foreground">${sub}</div>` : ''}</div></div>`;
  }
  CRM_openLead = (id) => {
    const l = D.leads.find(x => x.id === id); if (!l) return;
    openSheet(`${sheetHeader(l.name, l.suburb)}<div class="p-5 space-y-4">
      ${pill(l.stage, stageCls[l.stage])}
      <div class="card card-pad space-y-2 text-[13px]">
        <div class="flex justify-between"><span class="text-muted-foreground">Phone</span><span class="font-medium">${l.phone}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">Email</span><span class="font-medium">${l.email}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">Source</span><span>${l.source}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">Added</span><span>${l.date}</span></div>
      </div>
      <div><p class="lbl">Job needed</p><div class="card card-pad text-[13px]">${l.job}</div></div>
      <div class="flex gap-2"><button class="btn-primary flex-1 justify-center" onclick="CRM.toast('Convert to quote (mock)')">Create quote</button>
      <button class="btn-ghost flex-1 justify-center" onclick="CRM.toast('Book job (mock)')">Book job</button></div>
    </div>`);
  };
  CRM_openJob = (id) => {
    const j = D.jobs.find(x => x.id === id); if (!j) return;
    openSheet(`${sheetHeader(j.title, j.id)}<div class="p-5 space-y-4">
      ${pill(jobLabel[j.status], jobCls[j.status])}
      <div class="card card-pad space-y-2 text-[13px]">
        <div class="flex justify-between"><span class="text-muted-foreground">Client</span><span class="font-medium">${j.client}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">Address</span><span>${j.suburb}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">When</span><span>${['','Mon 11','Tue 12','Wed 13','Thu 14','Fri 15'][j.day]} · ${j.time}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">Value</span><span class="font-semibold">${fmt(j.value)}</span></div>
      </div>
      <div><p class="lbl">Photos</p><div class="grid grid-cols-3 gap-2">${[1,2,3].map(() => `<div class="aspect-square rounded-md bg-muted grid place-items-center text-muted-foreground"><i data-lucide="image" class="size-5"></i></div>`).join('')}</div></div>
      <div><p class="lbl">Notes</p><textarea class="in" rows="3" placeholder="Add a note…"></textarea></div>
    </div>`);
  };
  CRM_openClient = (id) => {
    const c = D.clients.find(x => x.id === id); if (!c) return;
    const tl = [['Job completed', c.last, COL.success], ['Invoice paid', c.last, COL.success], ['Quote accepted', '02 Jun', COL.info], ['First enquiry', '28 May', COL.violet]];
    openSheet(`${sheetHeader(c.name, c.suburb)}<div class="p-5 space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div class="card card-pad"><p class="card-sub">Total spent</p><p class="text-xl font-bold mt-1">${fmt(c.spent)}</p></div>
        <div class="card card-pad"><p class="card-sub">Jobs done</p><p class="text-xl font-bold mt-1">${c.jobs}</p></div>
      </div>
      <div class="card card-pad space-y-1 text-[13px]">
        <div class="flex justify-between"><span class="text-muted-foreground">Phone</span><span class="font-medium">${c.phone}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">Last job</span><span>${c.last}</span></div>
      </div>
      <div><p class="lbl">History</p><div class="timeline space-y-3 mt-2">
        ${tl.map(([t, d, col]) => `<div class="relative"><span class="tl-dot" style="background:${col}"></span><div class="text-[13px] font-medium">${t}</div><div class="text-xs text-muted-foreground">${d}</div></div>`).join('')}
      </div></div>
    </div>`);
  };
  CRM_openQuoteBuilder = (id) => {
    const q = id ? D.quotes.find(x => x.id === id) : null;
    const lines = D.quoteLines;
    const sub = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const gst = Math.round(sub * 0.1), total = sub + gst;
    const lineRows = lines.map(l => `<tr>
      <td>${l.desc}</td><td class="text-center tabular-nums">${l.qty}</td>
      <td class="text-right tabular-nums">${fmt(l.rate)}</td><td class="text-right font-medium tabular-nums">${fmt(l.qty * l.rate)}</td></tr>`).join('');
    openSheet(`${sheetHeader(q ? 'Quote ' + q.id : 'New quote', q ? q.client : 'Build a quote')}<div class="p-5 space-y-4">
      <div><label class="lbl">Client</label><input class="in" value="${q ? q.client : ''}" placeholder="Pick a client…"></div>
      <div class="card overflow-hidden">
        <table class="tbl"><thead><tr><th>Item</th><th class="text-center">Qty</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead><tbody>${lineRows}</tbody></table>
        <button class="w-full text-left px-4 py-2.5 text-[13px] text-primary font-medium hover:bg-muted/50 border-t" onclick="CRM.toast('Add from price list (mock)')"><i data-lucide="plus" class="size-3.5 inline -mt-0.5"></i> Add line from price list</button>
      </div>
      <div class="card card-pad space-y-1.5 text-[13px]">
        <div class="flex justify-between"><span class="text-muted-foreground">Subtotal</span><span class="tabular-nums">${fmt(sub)}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">GST (10%)</span><span class="tabular-nums">${fmt(gst)}</span></div>
        <div class="flex justify-between pt-1.5 border-t font-semibold text-[15px]"><span>Total</span><span class="tabular-nums">${fmt(total)}</span></div>
      </div>
      <div class="flex gap-2"><button class="btn-primary flex-1 justify-center" onclick="CRM.toast('Saved (mock)')">Save quote</button>
        <button class="btn-ghost justify-center" onclick="CRM.toast('Export PDF (mock)')"><i data-lucide="download" class="size-3.5"></i> PDF</button></div>
    </div>`);
  };

  /* ---------------- interactions ---------------- */
  function openSheet(html) { const s = $('#sheet'); $('#sheetBody').innerHTML = html; s.classList.remove('hidden'); icons(); }
  function closeSheet(e) { if (e && e.target !== $('#sheet') && e.currentTarget !== $('#sheet')) return; $('#sheet').classList.add('hidden'); }
  function icons() { if (window.lucide) window.lucide.createIcons(); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function render() {
    const [title, sub] = TITLES[state.view] || ['', ''];
    $('#pageTitle').textContent = title; $('#pageSub').textContent = sub;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === state.view));
    $('#view').innerHTML = (VIEWS[state.view] || home)();
    icons();
    if (state.view === 'leads' && state.leadsView === 'pipeline') wireKanban();
    if (state.view === 'chatbot') { const tr = $('#chatThread'); if (tr) tr.scrollTop = tr.scrollHeight; }
  }
  function go(v) { state.view = v; $('#newMenu').classList.add('hidden'); render(); }

  /* kanban drag */
  function wireKanban() {
    let dragId = null;
    document.querySelectorAll('.kan-card').forEach(c => {
      c.addEventListener('dragstart', () => { dragId = c.dataset.id; c.classList.add('dragging'); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    document.querySelectorAll('.kan-col').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('over');
        const l = D.leads.find(x => x.id === dragId);
        if (l) { l.stage = col.dataset.stage; render(); toast(l.name + ' → ' + l.stage); }
      });
    });
  }

  /* chat */
  function pushChat(from, text) { D.chat.push({ from, text }); render(); }
  function botReply(userText) {
    const t = userText.toLowerCase();
    let r = "No worries — I'll get that sorted and let you know once it's live. Anything else?";
    if (t.includes('colour') || t.includes('color')) r = "Easy — what colour are you after? I'll update your buttons and highlights across the whole site.";
    else if (t.includes('hour')) r = "Sure thing. What are your new opening hours? I'll update them everywhere, including your Google listing.";
    else if (t.includes('offer') || t.includes('special')) r = "Love it. What's the offer? I'll pop it on your home page as a banner.";
    else if (t.includes('photo') || t.includes('image')) r = "Got it — send through the photo and tell me where it goes, I'll swap it in.";
    setTimeout(() => pushChat('bot', r), 450);
  }
  function send() {
    const i = $('#chatInput'); if (!i || !i.value.trim()) return;
    const v = i.value.trim(); i.value = ''; pushChat('me', v); botReply(v);
  }

  /* public API */
  window.CRM = {
    go, toast, closeSheet,
    openLead: (id) => CRM_openLead(id), openJob: (id) => CRM_openJob(id),
    openClient: (id) => CRM_openClient(id), openQuoteBuilder: (id) => CRM_openQuoteBuilder(id),
    setLeadsView: (v) => { state.leadsView = v; render(); },
    setJobsView: (v) => { state.jobsView = v; render(); },
    setSetupTab: (v) => { state.setupTab = v; render(); },
    toggleTodo: (i) => { D.todos[i].done = !D.todos[i].done; },
    markPaid: (id) => { const inv = D.invoices.find(x => x.id === id); if (inv) { inv.status = 'Paid'; render(); toast(id + ' marked paid'); } },
    toggleNewMenu: (e) => { e.stopPropagation(); $('#newMenu').classList.toggle('hidden'); },
    preset: (p) => { $('#chatInput').value = p; send(); },
    send, chatKey: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
  };

  // nav + outside-click
  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => go(n.dataset.view)));
  document.addEventListener('click', e => { if (!e.target.closest('#newBtn') && !e.target.closest('#newMenu')) $('#newMenu')?.classList.add('hidden'); });

  // boot
  render();
})();
