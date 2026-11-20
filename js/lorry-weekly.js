/* ------------------------------------------------------------------
   lorry-weekly.js
   Weekly expenses: expenses are no longer deducted day by day.
   The daily Profit Report shows gross profit only. This card shows one
   week (Monday–Sunday) at a time: gross profit − the week's expenses = net profit.

   Add ONE line to lorry.html, after the lorry-deliveries.js line:
     <script src="js/lorry-weekly.js"></script>
------------------------------------------------------------------- */
(function () {
  const money = (n) => 'Ksh ' + Math.round(Number(n) || 0).toLocaleString();

  // Remove the old daily "Add Expense" block and stop the daily list from rendering
  const oldCat = document.getElementById('lorry-expense-category');
  if (oldCat) {
    const oldBlock = oldCat.closest('[style*="border-top"]');
    if (oldBlock) oldBlock.remove();
  }
  window.renderLorryExpensesList = function () {};

  // Monday–Sunday range containing the given YYYY-MM-DD
  function weekRange(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Mon = 0
    return {
      from: localISO(new Date(y, m - 1, d - dow)),
      to: localISO(new Date(y, m - 1, d - dow + 6))
    };
  }

  function shiftWeek(days) {
    const el = document.getElementById('week-date');
    const [y, m, d] = (el.value || todayDateInputValue()).split('-').map(Number);
    el.value = localISO(new Date(y, m - 1, d + days));
    loadWeekly();
  }

  // ─── UI ───
  const reportCard = document.getElementById('profit-report-date').closest('.card');
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'weekly-card';
  card.style.marginTop = '18px';
  card.innerHTML = `
    <h3 style="margin-top:0;">🗓 Weekly Expenses &amp; Net Profit</h3>
    <p style="color:var(--muted); font-size:0.85rem; margin-top:-8px;">
      Expenses are deducted once per week (Monday–Sunday), not daily.
    </p>
    <div class="report-toolbar">
      <div class="field"><button class="secondary" onclick="weeklyShift(-7)">◀ Prev week</button></div>
      <div class="field" style="max-width:170px;"><label>Any day in the week</label><input type="date" id="week-date"></div>
      <div class="field"><button class="secondary" onclick="weeklyShift(7)">Next week ▶</button></div>
      <div class="field"><button class="secondary" onclick="weeklyThis()">This week</button></div>
    </div>
    <div id="week-summary"></div>

    <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border, #2a3b52);">
      <h4 style="margin-bottom:8px;">Add Expense</h4>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="min-width:130px;"><label>Date</label><input type="date" id="wk-exp-date"></div>
        <div class="field" style="min-width:140px;"><label>Category</label>
          <select id="wk-exp-category">
            <option>Fuel</option><option>Maintenance</option><option>Wages</option>
            <option>Tolls/Parking</option><option>Other</option>
          </select></div>
        <div class="field" style="min-width:170px; flex:1;"><label>Description</label>
          <input type="text" id="wk-exp-description" placeholder="e.g. Diesel top-up"></div>
        <div class="field" style="min-width:110px;"><label>Amount (Ksh)</label>
          <input type="number" id="wk-exp-amount" min="0" step="1" placeholder="0"></div>
        <div class="field"><button onclick="weeklyAddExpense()">Add Expense</button></div>
      </div>
    </div>
    <div id="week-expenses" style="margin-top:10px;"></div>
  `;
  reportCard.parentNode.insertBefore(card, reportCard.nextSibling);

  window.weeklyShift = shiftWeek;
  window.weeklyThis = function () {
    document.getElementById('week-date').value = todayDateInputValue();
    loadWeekly();
  };

  // ─── LOAD WEEK ───
  window.loadWeekly = async function () {
    const dateEl = document.getElementById('week-date');
    if (!dateEl.value) dateEl.value = todayDateInputValue();
    const { from, to } = weekRange(dateEl.value);
    const sumEl = document.getElementById('week-summary');
    const listEl = document.getElementById('week-expenses');
    document.getElementById('wk-exp-date').value = document.getElementById('wk-exp-date').value || dateEl.value;

    if (!navigator.onLine) { sumEl.innerHTML = '<div class="empty-state">Weekly report needs internet.</div>'; return; }
    sumEl.innerHTML = '<div class="empty-state">Loading...</div>';

    const start = `${from}T00:00:00`, end = `${to}T23:59:59.999`;
    const [salesRes, expRes] = await Promise.all([
      supabaseClient.from('lorry_sales')
        .select('quantity, unit_price, unit_cost, store_products(cost)')
        .gte('created_at', start).lte('created_at', end),
      supabaseClient.from('expenses').select('*')
        .gte('created_at', start).lte('created_at', end)
        .order('created_at', { ascending: true })
    ]);
    if (salesRes.error) { sumEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(salesRes.error.message)}</div>`; return; }
    if (expRes.error) { sumEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(expRes.error.message)}</div>`; return; }

    const sales = salesRes.data || [], expenses = expRes.data || [];
    const revenue = sales.reduce((s, r) => s + r.quantity * r.unit_price, 0);
    const cost = sales.reduce((s, r) => s + r.quantity * (r.unit_cost ?? r.store_products?.cost ?? 0), 0);
    const gross = revenue - cost;
    const totalExp = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const net = gross - totalExp;
    const col = (v) => (v >= 0 ? '#1a7f37' : '#c0392b');
    const box = (label, val, color) => `<div><div style="color:var(--muted); font-size:0.75rem;">${label}</div>
      <div style="font-weight:800; font-size:1.15rem;${color ? ` color:${color};` : ''}">${val}</div></div>`;

    sumEl.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px;">Week: ${formatLedgerDate(from)} – ${formatLedgerDate(to)}</div>
      <div style="display:flex; gap:20px; flex-wrap:wrap;">
        ${box('Revenue', money(revenue))}
        ${box('Cost', money(cost))}
        ${box('Gross Profit', money(gross), col(gross))}
        ${box('Weekly Expenses', '-' + money(totalExp), '#c0392b')}
        ${box('Net Profit', money(net), col(net))}
      </div>`;

    const canDelete = currentStaff && currentStaff.role === 'admin';
    listEl.innerHTML = !expenses.length
      ? '<div class="empty-state">No expenses recorded for this week.</div>'
      : `<table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th>${canDelete ? '<th></th>' : ''}</tr></thead>
          <tbody>${expenses.map(e => `
            <tr>
              <td>${formatLedgerDate(localISO(new Date(e.created_at)))}</td>
              <td>${escapeHtml(e.category)}</td>
              <td>${escapeHtml(e.description || '—')}</td>
              <td style="color:#c0392b; font-weight:600;">${money(e.amount)}</td>
              ${canDelete ? `<td><button class="secondary" onclick="weeklyDeleteExpense('${e.id}')">Delete</button></td>` : ''}
            </tr>`).join('')}</tbody>
        </table>`;
  };

  // ─── ADD / DELETE EXPENSE ───
  window.weeklyAddExpense = async function () {
    const day = document.getElementById('wk-exp-date').value || todayDateInputValue();
    const category = document.getElementById('wk-exp-category').value;
    const description = document.getElementById('wk-exp-description').value.trim();
    const amount = Number(document.getElementById('wk-exp-amount').value);
    if (!amount || isNaN(amount) || amount <= 0) { alert('Please enter a valid expense amount.'); return; }

    const now = new Date();
    const [y, m, d] = day.split('-').map(Number);
    const createdAt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();

    const { error } = await supabaseClient.from('expenses').insert([{
      category, description: description || null, amount,
      recorded_by: currentStaff.id, created_at: createdAt
    }]);
    if (error) { alert('Error saving expense: ' + error.message); return; }

    document.getElementById('wk-exp-description').value = '';
    document.getElementById('wk-exp-amount').value = '';
    document.getElementById('week-date').value = day; // jump to the week just edited
    await loadWeekly();
  };

  window.weeklyDeleteExpense = async function (id) {
    if (!confirm('Delete this expense?')) return;
    const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
    if (error) { alert('Error deleting expense: ' + error.message); return; }
    await loadWeekly();
  };

  document.getElementById('week-date').addEventListener('change', loadWeekly);

  // Wait for login to finish, then load this week
  const wait = setInterval(() => {
    if (typeof currentStaff !== 'undefined' && currentStaff) {
      clearInterval(wait);
      document.getElementById('week-date').value = todayDateInputValue();
      document.getElementById('wk-exp-date').value = todayDateInputValue();
      loadWeekly();
    }
  }, 300);
})();
