// Lorry: move the sales (and optionally expenses) shown in the Profit Report to another date.
// Nothing is deleted or re-entered; stock is not touched. Admin only.
// Load it in lorry.html AFTER the inline script (put it next to lorry-deliveries.js).
(function () {
  const anchor = document.getElementById('profit-report-summary');
  if (!anchor) return;

  const box = document.createElement('div');
  box.id = 'move-date-box';
  box.style.cssText = 'display:none; margin:10px 0 14px; padding:12px; border:1px dashed var(--border, #33455c); border-radius:8px;';
  box.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">📅 Move this day's sales to another date</div>
    <div style="color:var(--muted); font-size:0.8rem; margin-bottom:8px;">
      Moves everything in the report above to the new date. Times are kept, nothing is re-entered, stock is not changed.
    </div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="margin:0; max-width:170px;">
        <label>Move to date</label>
        <input type="date" id="move-date-to">
      </div>
      <div class="field" style="margin:0;">
        <button onclick="moveReportDate()" id="move-date-btn">Move to this date</button>
      </div>
    </div>
    <label style="display:flex; gap:6px; align-items:center; margin-top:8px; font-size:0.85rem; cursor:pointer;">
      <input type="checkbox" id="move-date-expenses" checked> Also move this day's expenses
    </label>
    <p class="error-text" id="move-date-error" style="display:none;"></p>`;
  anchor.insertAdjacentElement('beforebegin', box);

  // currentStaff is filled in after login, so wait for it, then show the box to admins only
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (typeof currentStaff !== 'undefined' && currentStaff) {
      clearInterval(wait);
      if (currentStaff.role === 'admin') box.style.display = 'block';
    } else if (tries > 40) {
      clearInterval(wait);
    }
  }, 250);
})();

async function moveReportDate() {
  const errEl = document.getElementById('move-date-error');
  const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };
  errEl.style.display = 'none';

  const toDay = document.getElementById('move-date-to').value;
  const alsoExpenses = document.getElementById('move-date-expenses').checked;
  const r = currentReport;

  if (!r) return showErr('No report loaded yet. Wait for the report to appear.');
  if (!toDay) return showErr('Pick the date to move to.');
  if (toDay === r.fromDay) return showErr('That is the same date as the report.');
  if (!navigator.onLine) return showErr('Moving sales needs internet.');

  const sales = r.sales || [];
  const expenses = alsoExpenses ? (r.expenses || []) : [];
  if (!sales.length && !expenses.length) return showErr('There is nothing in this report to move.');

  const msg = `Move ${sales.length} sale(s)` + (alsoExpenses ? ` and ${expenses.length} expense(s)` : '') +
    ` from ${formatLedgerDate(r.fromDay)} to ${formatLedgerDate(toDay)}?`;
  if (!confirm(msg)) return;

  const btn = document.getElementById('move-date-btn');
  btn.disabled = true;
  btn.textContent = 'Moving...';

  // same clock time, new day
  const [y, m, d] = toDay.split('-').map(Number);
  const newStamp = (iso) => {
    const o = new Date(iso);
    return new Date(y, m - 1, d, o.getHours(), o.getMinutes(), o.getSeconds()).toISOString();
  };

  const run = (table, rows) => Promise.all(rows.map(row =>
    supabaseClient.from(table).update({ created_at: newStamp(row.created_at) }).eq('id', row.id).select('id')
  ));

  const [saleResults, expResults] = await Promise.all([run('lorry_sales', sales), run('expenses', expenses)]);

  btn.disabled = false;
  btn.textContent = 'Move to this date';

  const all = [...saleResults, ...expResults];
  const failed = all.filter(x => x.error);
  const untouched = all.filter(x => !x.error && (!x.data || !x.data.length)).length;

  if (failed.length) return showErr('Error: ' + failed[0].error.message);
  if (untouched) return showErr(`${untouched} row(s) could not be changed (permission blocked). Ask for the database update policy to be allowed for admin.`);

  document.getElementById('profit-report-date').value = toDay;
  document.getElementById('move-date-to').value = '';
  await loadProfitReport();
  alert(`✅ Moved to ${formatLedgerDate(toDay)}.`);
}
