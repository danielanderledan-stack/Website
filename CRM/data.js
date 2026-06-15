/* ============================================================
   Mock data — frontend preview only. No backend.
   ============================================================ */
window.DB = (function () {
  const business = {
    name: 'Sparky Dan Electrical',
    trade: 'Electrician',
    owner: 'Dan Anderle',
    phone: '0432 839 654',
    email: 'dan@sparkydan.com.au',
    address: '14 Beach Rd',
    suburb: 'Mentone VIC 3194',
    abn: '54 221 880 110',
    hours: 'Mon–Fri 7am–5pm · Sat 8am–12pm',
    primary: '#0ea5e9',
    dark: '#0f172a',
    font: 'Inter',
  };

  // 30-day series (oldest → newest)
  const days = Array.from({ length: 30 }, (_, i) => i);
  const revenueSeries = [120,0,340,210,0,0,180,420,260,0,510,330,140,0,0,290,610,180,250,0,0,470,520,90,380,0,210,640,300,180];
  const visitsSeries   = [3,4,6,5,4,2,5,8,7,5,9,11,8,6,4,7,12,10,9,6,5,11,13,7,10,8,9,14,12,9].map(v => v + 2);

  const leads = [
    { id: 'L-108', name: 'Mia Thompson',  phone: '0410 221 553', email: 'mia.t@gmail.com',     suburb: 'Brighton',   job: 'No power to kitchen — half the house out', source: 'Website form', stage: 'New',       date: '15 Jun', value: 0 },
    { id: 'L-107', name: 'Tom Reilly',    phone: '0422 887 100', email: 't.reilly@outlook.com', suburb: 'Hampton',    job: 'Ceiling fan install x2 in bedrooms',        source: 'Website form', stage: 'New',       date: '15 Jun', value: 0 },
    { id: 'L-106', name: 'Priya Nair',    phone: '0433 654 210', email: 'priya.n@gmail.com',    suburb: 'Sandringham', job: 'Switchboard looks old, wants a safety check', source: 'Phone',        stage: 'New',       date: '14 Jun', value: 0 },
    { id: 'L-105', name: 'Dave Wilkins',  phone: '0401 778 992', email: 'dwilkins@bigpond.com', suburb: 'Mentone',    job: 'EV charger install in garage',              source: 'Referral',     stage: 'Contacted', date: '13 Jun', value: 0 },
    { id: 'L-104', name: 'Grace Lo',      phone: '0455 120 348', email: 'grace.lo@gmail.com',   suburb: 'Cheltenham', job: 'Downlights through living + hallway',        source: 'Website form', stage: 'Quoted',    date: '12 Jun', value: 1450 },
    { id: 'L-103', name: 'Ben Carter',    phone: '0438 905 661', email: 'bcarter@gmail.com',    suburb: 'Beaumaris',  job: 'Add powerpoints to garage workshop',        source: 'Phone',        stage: 'Quoted',    date: '11 Jun', value: 680 },
    { id: 'L-102', name: 'Sara Mensah',   phone: '0412 443 870', email: 'sara.m@gmail.com',     suburb: 'Black Rock', job: 'Full rewire — 1960s home',                  source: 'Referral',     stage: 'Won',       date: '08 Jun', value: 8200 },
    { id: 'L-101', name: 'Owen Pike',     phone: '0466 332 119', email: 'owen.pike@gmail.com',  suburb: 'Parkdale',   job: 'Hot water unit not heating',                source: 'Website form', stage: 'Lost',      date: '06 Jun', value: 0 },
  ];

  const quotes = [
    { id: 'Q-2041', client: 'Grace Lo',     suburb: 'Cheltenham', total: 1450, status: 'Sent',     date: '12 Jun' },
    { id: 'Q-2040', client: 'Ben Carter',   suburb: 'Beaumaris',  total: 680,  status: 'Sent',     date: '11 Jun' },
    { id: 'Q-2039', client: 'Sara Mensah',  suburb: 'Black Rock', total: 8200, status: 'Accepted', date: '07 Jun' },
    { id: 'Q-2038', client: 'Janet Fyfe',   suburb: 'Hampton',    total: 320,  status: 'Draft',    date: '15 Jun' },
    { id: 'Q-2037', client: 'Owen Pike',    suburb: 'Parkdale',   total: 540,  status: 'Lost',     date: '06 Jun' },
  ];

  const quoteLines = [
    { desc: 'Supply & install LED downlights (per fitting)', qty: 8, rate: 95 },
    { desc: 'Run new circuit from switchboard',              qty: 1, rate: 380 },
    { desc: 'Make good & test',                              qty: 1, rate: 120 },
  ];

  // this week jobs (Mon=15? — we treat 15 Jun as Friday "today"; week strip Mon–Sun)
  const jobs = [
    { id: 'J-501', client: 'Carlton Body Corp', title: 'Switchboard upgrade', suburb: 'Mentone',     day: 1, time: '9:00',  status: 'booked', value: 1850 },
    { id: 'J-502', client: 'Grace Lo',          title: 'Downlights',          suburb: 'Cheltenham',  day: 2, time: '8:00',  status: 'onsite', value: 1450 },
    { id: 'J-503', client: 'Dave Wilkins',      title: 'EV charger install',  suburb: 'Mentone',     day: 2, time: '13:00', status: 'booked', value: 1200 },
    { id: 'J-504', client: 'Priya Nair',        title: 'Safety check',        suburb: 'Sandringham', day: 3, time: '10:30', status: 'booked', value: 220  },
    { id: 'J-505', client: 'Ben Carter',        title: 'Powerpoints x4',      suburb: 'Beaumaris',   day: 5, time: '9:00',  status: 'done',   value: 680  },
    { id: 'J-506', client: 'Sara Mensah',       title: 'Rewire — day 1',      suburb: 'Black Rock',  day: 5, time: '7:30',  status: 'booked', value: 8200 },
  ];

  const invoices = [
    { id: 'INV-1188', client: 'Sara Mensah',  amount: 2733, status: 'Paid',    due: '05 Jun', issued: '01 Jun' },
    { id: 'INV-1187', client: 'Ben Carter',   amount: 680,  status: 'Unpaid',  due: '20 Jun', issued: '13 Jun' },
    { id: 'INV-1186', client: 'Carlton Body Corp', amount: 1120, status: 'Unpaid', due: '18 Jun', issued: '11 Jun' },
    { id: 'INV-1185', client: 'M. Doyle',     amount: 540,  status: 'Overdue', due: '01 Jun', issued: '18 May' },
    { id: 'INV-1184', client: 'K. Singh',     amount: 1260, status: 'Overdue', due: '28 May', issued: '14 May' },
    { id: 'INV-1183', client: 'Grace Lo',     amount: 1450, status: 'Paid',    due: '10 Jun', issued: '03 Jun' },
  ];

  const monthRevenue = [
    { m: 'Jan', v: 9200 }, { m: 'Feb', v: 11400 }, { m: 'Mar', v: 8800 },
    { m: 'Apr', v: 13200 }, { m: 'May', v: 12100 }, { m: 'Jun', v: 4250 },
  ];

  const clients = [
    { id: 'C-01', name: 'Sara Mensah',  phone: '0412 443 870', suburb: 'Black Rock', jobs: 3, spent: 9650, last: '08 Jun' },
    { id: 'C-02', name: 'Grace Lo',     phone: '0455 120 348', suburb: 'Cheltenham', jobs: 2, spent: 2900, last: '12 Jun' },
    { id: 'C-03', name: 'Ben Carter',   phone: '0438 905 661', suburb: 'Beaumaris',  jobs: 1, spent: 680,  last: '11 Jun' },
    { id: 'C-04', name: 'Carlton Body Corp', phone: '03 9555 1200', suburb: 'Mentone', jobs: 5, spent: 14200, last: '15 Jun' },
    { id: 'C-05', name: 'Dave Wilkins', phone: '0401 778 992', suburb: 'Mentone',    jobs: 1, spent: 0,    last: '—' },
    { id: 'C-06', name: 'Janet Fyfe',   phone: '0419 220 771', suburb: 'Hampton',    jobs: 2, spent: 1540, last: '02 Jun' },
  ];

  const todos = [
    { t: 'Ring Dave back re: EV charger', done: false, due: 'Today' },
    { t: 'Order 2× RCBO for Mentone switchboard', done: false, due: 'Today' },
    { t: 'Send Grace the downlights quote', done: true, due: 'Yesterday' },
    { t: 'Book Black Rock rewire materials', done: false, due: 'Tue' },
  ];

  const stats = {
    visits: 142, visitsDelta: 18, unique: 96, contactClicks: 11, calls: 7,
    topPages: [
      { p: '/', v: 64 }, { p: '/services', v: 38 }, { p: '/pricing', v: 22 },
      { p: '/contact', v: 12 }, { p: '/about', v: 6 },
    ],
    sources: [
      { s: 'Google', v: 71, c: 'var(--info)' },
      { s: 'Direct', v: 34, c: 'var(--violet)' },
      { s: 'Facebook', v: 21, c: 'var(--success)' },
      { s: 'Referral', v: 16, c: 'var(--warning)' },
    ],
  };

  const chat = [
    { from: 'bot', text: "G'day Dan 👋 I'm your website assistant. Tell me what you'd like to change and I'll sort it — colours, your hours, a special offer, swap a photo, fix some wording. What's up?" },
  ];

  return {
    business, days, revenueSeries, visitsSeries, leads, quotes, quoteLines,
    jobs, invoices, monthRevenue, clients, todos, stats, chat,
    fmt: (n) => '$' + Number(n).toLocaleString('en-AU'),
  };
})();
