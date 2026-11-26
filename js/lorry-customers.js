/* ------------------------------------------------------------------
   lorry-customers.js — Customer Accounts
   One account per customer: every delivery (products, qty, price),
   every payment (cash / M-Pesa) and the credit balance, each with a date.
   Balance = total delivered − total paid.
   Pick a customer to see each day's orders, cash / M-Pesa payments and credit,
   and to record a credit payment (shows credit before → after).
   Saving a delivery also takes the stock off the lorry and records the
   sales, so the Profit Report stays correct.
   Customer details (name, phone, location, notes) can be edited with the
   ✏️ Edit button on an open account. Needs the `notes` column and an UPDATE
   policy on lorry_customer_ledger.
   Requires lorry-customer-ledger.sql (run once in Supabase).
------------------------------------------------------------------- */
(function () {
  let accounts = [];      // grouped customers
  let custQty = {}, custPrice = {};
  let deliveryTotal = 0;
  let selectedKey = '';   // customer account currently open

  const money = (n) => 'Ksh ' + Math.round(Number(n) || 0).toLocaleString();
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  const keyOf = (name) => (name || '').trim().toLowerCase();

  // ─── UI ───
  const reportCard = document.getElementById('profit-report-date').closest('.card');
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'customers-card';
  card.style.marginBottom = '18px';
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
      <h3 style="margin:0;">👥 Customer Accounts</h3>
      <div style="display:flex; gap:8px;">
        <button onclick="custToggleForm()">+ New Delivery</button>
        <button class="secondary" onclick="custTogglePast()">+ Add Past Record</button>
        <button class="secondary" onclick="loadCustomers()">Refresh</button>
      </div>
    </div>
    <p style="color:var(--muted); font-size:0.85rem; margin:6px 0 10px;">
      Each customer has an account showing every delivery, every payment (cash / M-Pesa) and what they still owe, with dates.
    </p>

    <div id="cust-form" style="display:none; border:1px solid var(--border, #33455c); border-radius:8px; padding:12px; margin-bottom:12px;">
      <h4 style="margin:0 0 8px;">New Delivery <span style="font-weight:400; color:var(--muted); font-size:0.8rem;">(dated today; taken off the lorry)</span></h4>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:160px;"><label>Customer name *</label>
          <input type="text" id="cust-name" list="cust-names" placeholder="e.g. Mary Wanjiru" autocomplete="off" onchange="custAutofill()">
          <datalist id="cust-names"></datalist></div>
        <div class="field" style="flex:1; min-width:150px;"><label>Location</label><input type="text" id="cust-location" placeholder="e.g. Kasarani, Mwiki"></div>
      </div>
      <div id="cust-items" style="max-height:280px; overflow-y:auto; border:1px solid var(--border, #e2e6ea); border-radius:8px;"></div>
      <div style="display:flex; justify-content:space-between; margin:10px 0 4px;">
        <span style="color:var(--muted); font-size:0.85rem;">Delivery total</span><strong id="cust-total">Ksh 0</strong>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="flex:1; min-width:140px;"><label>Paid now (Ksh) — leave 0 for full credit</label>
          <input type="number" id="cust-paid" min="0" step="any" placeholder="0" oninput="custUpdateBalance()"></div>
        <div class="field" style="flex:1; min-width:120px;"><label>Paid via</label>
          <select id="cust-via"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></div>
        <div class="field" style="flex:1; min-width:120px;"><label>Balance on credit</label>
          <div id="cust-balance" style="font-weight:800; color:#c0392b; padding:8px 0;">Ksh 0</div></div>
      </div>
      <button onclick="custSaveDelivery()" style="width:100%; margin-top:6px;">Save Delivery</button>
      <p class="error-text" id="cust-error" style="display:none;"></p>
    </div>


    <div id="cust-past" style="display:none; border:1px solid var(--border, #33455c); border-radius:8px; padding:12px; margin-bottom:12px;">
      <h4 style="margin:0 0 4px;">Add Past Customer Record</h4>
      <p style="color:var(--muted); font-size:0.8rem; margin:0 0 10px;">Written to the customer's account only — lorry stock and the Profit Report are not changed.</p>
      <div class="field"><label>Customer name *</label>
        <input type="text" id="past-name" list="cust-names" placeholder="e.g. Mary Wanjiru" autocomplete="off"></div>
      <datalist id="cust-products"></datalist>

      <h5 style="margin:8px 0 6px;">1. The order</h5>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:140px;"><label>Order date *</label><input type="date" id="past-date"></div>
        <div class="field" style="flex:1; min-width:140px;"><label>Order total (Ksh) *</label>
          <input type="number" id="past-total-input" min="0" step="any" placeholder="0" oninput="custPastRecalc()"></div>
      </div>
      <details style="margin-bottom:8px;">
        <summary style="cursor:pointer; color:var(--muted); font-size:0.85rem;">Add product details (optional — fills the total for you)</summary>
        <div id="past-lines" oninput="custPastTotal()" style="margin-top:8px;"></div>
        <button class="secondary" type="button" onclick="custPastAddLine()">+ Add product line</button>
      </details>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:140px;"><label>Paid on the order day (Ksh)</label>
          <input type="number" id="past-del-paid" min="0" step="any" placeholder="0" oninput="custPastRecalc()"></div>
        <div class="field" style="flex:1; min-width:110px;"><label>Paid via</label>
          <select id="past-del-via"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></div>
      </div>
      <div style="display:flex; justify-content:space-between; margin:2px 0 10px;">
        <span style="color:var(--muted); font-size:0.85rem;">Credit after the order day</span>
        <strong id="past-credit" style="color:#c0392b;">Ksh 0</strong>
      </div>

      <h5 style="margin:8px 0 6px;">2. Later payments of the credit <span style="font-weight:400; color:var(--muted); font-size:0.8rem;">(one row per payment, each with its date)</span></h5>
      <div id="past-credit-pays" oninput="custPastRecalc()"></div>
      <button class="secondary" type="button" onclick="custPastAddPay()">+ Add a credit payment</button>
      <div style="display:flex; justify-content:space-between; margin:10px 0;">
        <span style="font-weight:700;">Credit still remaining</span>
        <strong id="past-remaining" style="color:#c0392b;">Ksh 0</strong>
      </div>

      <button onclick="custSavePast()" style="width:100%;">Save Past Record</button>
      <p class="error-text" id="past-err" style="display:none;"></p>
    </div>

    <div class="field"><label>Select customer account</label>
      <select id="cust-pick" onchange="custPick()"><option value="">— Choose a customer —</option></select></div>
    <div id="cust-owed" style="margin:2px 0 10px; font-weight:800; color:#c0392b;"></div>
    <div id="cust-detail"></div>
    <div id="cust-list"><div class="empty-state">Loading...</div></div>
  `;
  const leftCol = document.getElementById('close-route-payment').closest('.card').parentNode;
  card.style.marginTop = '18px'; card.style.marginBottom = '0';
  const bulkCard = document.getElementById('bulk-date') && document.getElementById('bulk-date').closest('.card');
  if (bulkCard && bulkCard.parentNode === leftCol) leftCol.insertBefore(card, bulkCard); else leftCol.appendChild(card);

  window.custToggleForm = function () {
    const f = document.getElementById('cust-form');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
    renderItems();
  };

  // ─── DELIVERY FORM ───
  function priceFor(r) {
    if (custPrice[r.store_product_id] !== undefined) return custPrice[r.store_product_id];
    if (typeof closeRoutePrices !== 'undefined' && closeRoutePrices[r.store_product_id] !== undefined) return closeRoutePrices[r.store_product_id];
    return (r.store_products || {}).price ?? 0;
  }

  function renderItems() {
    const el = document.getElementById('cust-items');
    if (!el) return;
    if (!lorryStock.length) { el.innerHTML = '<div class="empty-state">Nothing on the lorry — load stock first.</div>'; updateTotal(); return; }
    el.innerHTML = `<table>
      <thead><tr><th>Product</th><th>On Lorry</th><th>Qty</th><th>Price (Ksh)</th></tr></thead>
      <tbody>${lorryStock.map(r => `<tr>
        <td>${escapeHtml(displayName(r.store_products || {}))}</td>
        <td><span class="badge in_stock">${r.quantity}</span></td>
        <td><input type="number" min="0" step="any" style="width:70px;" placeholder="0" value="${custQty[r.store_product_id] ?? ''}"
              oninput="custSetQty('${r.store_product_id}', this.value)"></td>
        <td><input type="number" min="0" step="any" style="width:90px;" value="${priceFor(r)}"
              oninput="custSetPrice('${r.store_product_id}', this.value)"></td>
      </tr>`).join('')}</tbody></table>`;
    updateTotal();
  }

  function updateTotal() {
    let t = 0;
    lorryStock.forEach(r => { const q = Number(custQty[r.store_product_id]) || 0; if (q > 0) t += q * (Number(priceFor(r)) || 0); });
    deliveryTotal = t;
    const el = document.getElementById('cust-total');
    if (el) el.textContent = money(t);
    window.custUpdateBalance();
  }

  window.custUpdateBalance = function () {
    const el = document.getElementById('cust-balance'), p = document.getElementById('cust-paid');
    if (!el || !p) return;
    el.textContent = money(Math.max(deliveryTotal - (parseFloat(p.value) || 0), 0));
  };
  window.custSetQty = (id, v) => { const n = parseFloat(v); if (isNaN(n) || n <= 0) delete custQty[id]; else custQty[id] = n; updateTotal(); };
  window.custSetPrice = (id, v) => { const n = parseFloat(v); custPrice[id] = isNaN(n) ? 0 : n; updateTotal(); };

  window.custAutofill = function () {
    const a = accounts.find(x => x.key === keyOf(document.getElementById('cust-name').value));
    if (!a) return;
    if (!document.getElementById('cust-location').value) document.getElementById('cust-location').value = a.location || '';
  };

  // ─── SAVE DELIVERY ───
  window.custSaveDelivery = async function () {
    const errEl = document.getElementById('cust-error');
    errEl.style.display = 'none';
    const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };

    const name = document.getElementById('cust-name').value.trim();
    const location = document.getElementById('cust-location').value.trim();
    const via = document.getElementById('cust-via').value;
    const paidNow = parseFloat(document.getElementById('cust-paid').value) || 0;
    if (!name) return showErr('Enter the customer name.');

    const lines = [];
    for (const r of lorryStock) {
      const qty = Number(custQty[r.store_product_id]) || 0;
      if (qty <= 0) continue;
      const label = displayName(r.store_products || {});
      const price = parseFloat(priceFor(r));
      if (qty > Number(r.quantity)) return showErr(`Only ${r.quantity} of ${label} on the lorry.`);
      if (!price || price <= 0) return showErr(`Enter a valid price for ${label}.`);
      lines.push({ row: r, qty, price, label });
    }
    if (!lines.length) return showErr('Enter a quantity for at least one item delivered.');
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    if (paidNow < 0 || paidNow > total) return showErr(`Paid now must be between 0 and ${money(total)}.`);
    if (!navigator.onLine) return showErr('Saving a delivery needs internet.');

    const saleMethod = paidNow >= total ? via : (paidNow > 0 ? 'mixed' : 'credit');
    if (!confirm(`${name}\n${lines.length} item(s), total ${money(total)}\nPaid now: ${money(paidNow)} (${via})\nOn credit: ${money(total - paidNow)}\n\nSave this delivery?`)) return;

    const okLines = [], failed = [];
    for (const l of lines) {
      const { error } = await supabaseClient.rpc('record_lorry_sale', {
        p_store_product_id: l.row.store_product_id, p_quantity: l.qty, p_unit_price: l.price,
        p_customer_name: name, p_customer_phone: null, p_payment_method: saleMethod,
        p_staff_id: currentStaff.id, p_synced: true
      });
      if (error) { failed.push(`${l.label}: ${error.message}`); continue; }
      okLines.push(l);
    }
    if (!okLines.length) return showErr('Nothing saved. ' + failed.join('; '));

    const okTotal = okLines.reduce((s, l) => s + l.qty * l.price, 0);
    const paid = Math.min(paidNow, okTotal);
    const now = new Date();
    const rows = [{
      customer_name: name, location: location || null, entry_type: 'delivery', paid_at_order: false,
      items: okLines.map(l => ({ name: l.label, qty: l.qty, price: l.price })),
      amount: okTotal, staff_id: currentStaff.id, created_at: now.toISOString()
    }];
    if (paid > 0) rows.push({
      customer_name: name, location: location || null, entry_type: 'payment',
      amount: paid, method: via, paid_at_order: true, staff_id: currentStaff.id, created_at: new Date(now.getTime() + 1000).toISOString()
    });
    const { error: ledErr } = await supabaseClient.from('lorry_customer_ledger').insert(rows);
    selectedKey = keyOf(name);
    okLines.forEach(l => { delete custQty[l.row.store_product_id]; delete custPrice[l.row.store_product_id]; });

    await Promise.all([loadLorryStock(), loadProfitReport()]);
    if (typeof loadWeekly === 'function') loadWeekly();
    await loadCustomers();

    if (ledErr) return showErr(`Stock was taken off the lorry but the account entry FAILED: ${ledErr.message}. Add it manually: ${name}, ${money(okTotal)}, paid ${money(paid)}.`);
    if (failed.length) return showErr(`Saved ${okLines.length} item(s). Not saved: ${failed.join('; ')}.`);

    ['cust-name', 'cust-location', 'cust-paid'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cust-form').style.display = 'none';
    renderItems();
    alert(`✅ Delivery saved for ${name} — ${money(paid)} paid, ${money(okTotal - paid)} on credit.`);
  };

  // ─── LOAD + RENDER ACCOUNTS ───
  window.loadCustomers = async function () {
    const listEl = document.getElementById('cust-list');
    if (!navigator.onLine) { listEl.innerHTML = '<div class="empty-state">Customer accounts need internet.</div>'; return; }
    const { data, error } = await supabaseClient.from('lorry_customer_ledger').select('*').order('created_at', { ascending: true });
    if (error) { listEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(error.message)}</div>`; return; }

    const map = {};
    (data || []).forEach(e => {
      const k = keyOf(e.customer_name);
      const a = map[k] = map[k] || { key: k, name: e.customer_name, phone: '', location: '', notes: '', entries: [], delivered: 0, paid: 0 };
      a.name = e.customer_name;
      if (e.phone) a.phone = e.phone;
      if (e.location) a.location = e.location;
      if (e.notes) a.notes = e.notes;
      a.entries.push(e);
      if (e.entry_type === 'delivery') a.delivered += Number(e.amount); else a.paid += Number(e.amount);
    });
    accounts = Object.values(map).map(a => ({ ...a, balance: a.delivered - a.paid }))
      .sort((x, y) => (y.balance > 0) - (x.balance > 0) || x.name.localeCompare(y.name));

    document.getElementById('cust-names').innerHTML = accounts.map(a => `<option value="${escapeAttr(a.name)}">`).join('');
    renderAccounts();
  };

  window.custPick = function () { selectedKey = document.getElementById('cust-pick').value; renderAccounts(); };
  window.custSelectIdx = function (i) {
    if (!accounts[i]) return;
    selectedKey = accounts[i].key;
    renderAccounts();
    document.getElementById('cust-pick').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Entries in order, each with the credit balance before and after it
  function timeline(a) {
    const sorted = a.entries.slice().sort((x, y) =>
      new Date(x.created_at) - new Date(y.created_at) || (x.entry_type === 'delivery' ? -1 : 1));
    let run = 0;
    return sorted.map(e => {
      const before = run;
      run += e.entry_type === 'delivery' ? Number(e.amount) : -Number(e.amount);
      return { e, before, after: run };
    });
  }

  // One row per day: what was ordered, cash / M-Pesa paid, credit added or reduced, credit left at day end
  function dailyRows(tl) {
    const days = {};
    tl.forEach(({ e, after }) => {
      const k = localISO(new Date(e.created_at));
      const d = days[k] = days[k] || { day: k, items: [], ordered: 0, cash: 0, mpesa: 0, end: 0 };
      if (e.entry_type === 'delivery') { d.ordered += Number(e.amount); (e.items || []).forEach(i => d.items.push(i)); }
      else if (e.method === 'mpesa') d.mpesa += Number(e.amount);
      else d.cash += Number(e.amount);
      d.end = after;
    });
    return Object.values(days).sort((x, y) => x.day.localeCompare(y.day));
  }

  function detailHtml(a) {
    const canDelete = currentStaff && currentStaff.role === 'admin';
    const tl = timeline(a);
    const days = dailyRows(tl);
    const pays = a.entries.filter(e => e.entry_type === 'payment');
    const cash = pays.filter(e => e.method !== 'mpesa').reduce((s, e) => s + Number(e.amount), 0);
    const mpesa = pays.filter(e => e.method === 'mpesa').reduce((s, e) => s + Number(e.amount), 0);
    const tile = (label, val, color) => `<div style="flex:1; min-width:110px; border:1px solid var(--border, #33455c); border-radius:8px; padding:8px 10px;">
      <div style="color:var(--muted); font-size:0.75rem;">${label}</div>
      <div style="font-weight:800; font-size:1.05rem;${color ? ' color:' + color + ';' : ''}">${val}</div></div>`;

    const dayRows = days.map(d => {
      const change = d.ordered - d.cash - d.mpesa;
      const prods = d.items.map(i => `${i.qty} × ${escapeHtml(i.name)} @ ${Math.round(i.price).toLocaleString()}`).join('<br>') || (d.ordered ? 'Order — no product details' : '—');
      const chg = change > 0 ? `<span style="color:#c0392b;">+${money(change)}<br><small>credit added</small></span>`
        : change < 0 ? `<span style="color:#1a7f37;">−${money(-change)}<br><small>credit reduced</small></span>` : '—';
      return `<tr>
        <td>${fmtDate(d.day + 'T12:00:00')}</td><td>${prods}</td>
        <td>${d.ordered ? money(d.ordered) : '—'}</td><td>${d.cash ? money(d.cash) : '—'}</td><td>${d.mpesa ? money(d.mpesa) : '—'}</td>
        <td>${chg}</td><td style="font-weight:700;">${money(d.end)}</td></tr>`;
    }).join('');

    const creditPays = tl.filter(t => t.e.entry_type === 'payment' && !t.e.paid_at_order);
    const paidTowardCredit = creditPays.reduce((s, t) => s + Number(t.e.amount), 0);
    const payRows = creditPays.map(({ e, before, after }) => `<tr>
      <td>${fmtDate(e.created_at)}</td><td>${e.method === 'mpesa' ? 'M-Pesa' : 'Cash'}</td>
      <td style="color:#1a7f37; font-weight:700;">−${money(e.amount)}</td><td>${money(before)}</td>
      <td style="font-weight:700;">${money(after)}</td>
      ${canDelete ? `<td style="white-space:nowrap;"><button class="secondary" onclick="custEditEntry('${e.id}')">✎</button> <button class="secondary" onclick="custDeleteEntry('${e.id}')">✕</button></td>` : ''}</tr>`).join('');

    const payForm = a.balance > 0 ? `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="flex:1; min-width:120px;"><label>Amount paid (Ksh)</label>
          <input type="number" id="cp-amt" min="0" step="any" placeholder="0" oninput="custPayPreview()"></div>
        <div class="field" style="flex:1; min-width:110px;"><label>Paid via</label>
          <select id="cp-via"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></div>
        <div class="field" style="flex:1; min-width:140px;"><label>Date paid</label>
          <input type="date" id="cp-date" value="${todayDateInputValue()}"></div>
      </div>
      <div id="cp-preview" style="margin:4px 0 8px; font-weight:700;">Credit now: ${money(a.balance)}</div>
      <button onclick="custPayCredit()" style="width:100%;">Record Credit Payment</button>
      <p class="error-text" id="cp-err" style="display:none;"></p>`
      : '<div style="color:#1a7f37; font-weight:700;">✅ No credit outstanding — this account is cleared.</div>';

    const allEntries = canDelete ? `<details style="margin-top:10px;"><summary style="cursor:pointer; color:var(--muted); font-size:0.85rem;">All entries (admin — edit or delete a wrong entry)</summary>
      <table style="margin-top:6px;"><tbody>${tl.map(({ e }) => `<tr>
        <td>${fmtDate(e.created_at)}</td><td>${e.entry_type === 'delivery' ? 'Order' : 'Paid ' + (e.method === 'mpesa' ? 'M-Pesa' : 'Cash')}</td><td>${money(e.amount)}</td>
        <td style="white-space:nowrap;"><button class="secondary" onclick="custEditEntry('${e.id}')">✎</button> <button class="secondary" onclick="custDeleteEntry('${e.id}')">✕</button></td></tr>`).join('')}</tbody></table></details>` : '';

    // Contact details shown under the customer's name
    const contact = [
      a.phone ? '📞 ' + escapeHtml(a.phone) : '',
      a.location ? '📍 ' + escapeHtml(a.location) : ''
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const notesLine = a.notes
      ? `<div style="font-size:0.85rem; margin-top:4px; white-space:pre-wrap;">📝 ${escapeHtml(a.notes)}</div>` : '';

    const fieldStyle = 'width:100%; box-sizing:border-box; font:inherit; padding:8px; border-radius:6px; border:1px solid var(--border, #33455c); background:transparent; color:inherit;';
    const editForm = `<div id="cust-edit-form" style="display:none; border:1px dashed var(--border, #33455c); border-radius:8px; padding:10px; margin-bottom:10px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:150px;"><label>Customer name *</label>
          <input type="text" id="ce-name" value="${escapeAttr(a.name)}"></div>
        <div class="field" style="flex:1; min-width:130px;"><label>Phone</label>
          <input type="tel" id="ce-phone" value="${escapeAttr(a.phone)}" placeholder="e.g. 0712 345 678"></div>
        <div class="field" style="flex:1; min-width:130px;"><label>Location</label>
          <input type="text" id="ce-location" value="${escapeAttr(a.location)}" placeholder="e.g. Kasarani, Mwiki"></div>
      </div>
      <div class="field"><label>Notes / extra information</label>
        <textarea id="ce-notes" rows="3" style="${fieldStyle}" placeholder="e.g. Pays on Fridays, shop near the stage, second contact...">${escapeHtml(a.notes)}</textarea></div>
      <div style="display:flex; gap:10px;">
        <button onclick="custSaveEdit()" style="flex:1;">Save Customer</button>
        <button class="secondary" onclick="custToggleEdit()" style="flex:1;">Cancel</button>
      </div>
      <p class="error-text" id="ce-err" style="display:none;"></p>
    </div>`;

    return `<div style="border:1px solid var(--border, #33455c); border-radius:8px; padding:12px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:8px;">
        <div>
          <div style="font-weight:800; font-size:1.05rem;">${escapeHtml(a.name)}</div>
          <div style="color:var(--muted); font-size:0.8rem;">${contact || 'No phone or location saved yet'}</div>
          ${notesLine}
        </div>
        <button class="secondary" onclick="custToggleEdit()" style="white-space:nowrap;">✏️ Edit</button>
      </div>
      ${editForm}
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        ${tile('Total ordered', money(a.delivered))}
        ${tile('Paid — Cash', money(cash))}
        ${tile('Paid — M-Pesa', money(mpesa))}
        ${tile('Credit remaining', money(a.balance), a.balance > 0 ? '#c0392b' : '#1a7f37')}
      </div>

      <h4 style="margin:6px 0;">📅 Day by day</h4>
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Date</th><th>Products ordered</th><th>Ordered</th><th>Cash</th><th>M-Pesa</th><th>Credit change</th><th>Credit left</th></tr></thead>
        <tbody>${dayRows}</tbody></table></div>

      <h4 style="margin:14px 0 6px;">💳 Customer pays credit</h4>
      ${payForm}

      <h4 style="margin:14px 0 6px;">Credit payments made${creditPays.length ? ` — total ${money(paidTowardCredit)}` : ''}</h4>
      ${creditPays.length
        ? `<div style="overflow-x:auto;"><table><thead><tr><th>Date</th><th>Method</th><th>Reduced by</th><th>Credit before</th><th>Credit after</th>${canDelete ? '<th></th>' : ''}</tr></thead><tbody>${payRows}</tbody></table></div>`
        : '<div class="empty-state">No credit payments yet.</div>'}
      <div style="margin-top:8px; font-weight:800;">Total credit remaining: <span style="color:${a.balance > 0 ? '#c0392b' : '#1a7f37'};">${money(a.balance)}</span></div>
      ${allEntries}
    </div>`;
  }

  function renderAccounts() {
    const pick = document.getElementById('cust-pick');
    pick.innerHTML = '<option value="">— Choose a customer —</option>' + accounts.map(a =>
      `<option value="${escapeAttr(a.key)}">${escapeHtml(a.name)} — ${a.balance > 0 ? 'owes ' + money(a.balance) : 'cleared'}</option>`).join('');
    if (!accounts.find(a => a.key === selectedKey)) selectedKey = '';
    pick.value = selectedKey;

    const owed = accounts.reduce((s, a) => s + Math.max(a.balance, 0), 0);
    document.getElementById('cust-owed').textContent = accounts.length ? `Total credit owed by all customers: ${money(owed)}` : '';

    const sel = accounts.find(a => a.key === selectedKey);
    document.getElementById('cust-detail').innerHTML = sel ? detailHtml(sel) : '';

    const listEl = document.getElementById('cust-list');
    if (!accounts.length) { listEl.innerHTML = '<div class="empty-state">No customer accounts yet. Use + New Delivery or + Add Past Record.</div>'; return; }
    listEl.innerHTML = `<h4 style="margin:10px 0 6px;">All customers <span style="font-weight:400; color:var(--muted); font-size:0.8rem;">(tap one to open it)</span></h4>
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Customer</th><th>Ordered</th><th>Paid</th><th>Credit left</th></tr></thead>
        <tbody>${accounts.map((a, i) => `<tr style="cursor:pointer;${a.key === selectedKey ? ' font-weight:700;' : ''}" onclick="custSelectIdx(${i})">
          <td>${escapeHtml(a.name)}</td><td>${money(a.delivered)}</td><td>${money(a.paid)}</td>
          <td style="color:${a.balance > 0 ? '#c0392b' : '#1a7f37'}; font-weight:700;">${a.balance > 0 ? money(a.balance) : 'Cleared'}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  // ─── EDIT CUSTOMER DETAILS (name, phone, location, notes) ───
  window.custToggleEdit = function () {
    const f = document.getElementById('cust-edit-form');
    if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
  };

  window.custSaveEdit = async function () {
    const a = accounts.find(x => x.key === selectedKey);
    if (!a) return;
    const errEl = document.getElementById('ce-err');
    errEl.style.display = 'none';
    const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };

    const name = document.getElementById('ce-name').value.trim();
    const phone = document.getElementById('ce-phone').value.trim();
    const location = document.getElementById('ce-location').value.trim();
    const notes = document.getElementById('ce-notes').value.trim();
    if (!name) return showErr('Customer name cannot be empty.');
    if (!navigator.onLine) return showErr('Editing a customer needs internet.');

    const newKey = keyOf(name);
    if (newKey !== a.key && accounts.some(x => x.key === newKey)) {
      if (!confirm(`A customer named "${name}" already exists.\n\nSaving will merge ${a.name}'s records into that account. Continue?`)) return;
    }

    // Every ledger row of this customer carries the same details
    const oldNames = [...new Set(a.entries.map(e => e.customer_name))];
    const patch = { customer_name: name, phone: phone || null, location: location || null, notes: notes || null };
    const { data, error } = await supabaseClient
      .from('lorry_customer_ledger').update(patch).in('customer_name', oldNames).select('id');
    if (error) return showErr('Error: ' + error.message);
    // With row-level security, a blocked update affects 0 rows without an error
    if (!data || data.length < a.entries.length) {
      return showErr(`Only ${data ? data.length : 0} of ${a.entries.length} records were updated. Check the UPDATE policy on lorry_customer_ledger, then try again.`);
    }

    // Keep the Profit Report's customer names in step after a rename (best effort)
    if (oldNames.some(n => n !== name)) {
      await supabaseClient.from('lorry_sales').update({ customer_name: name }).in('customer_name', oldNames);
    }

    selectedKey = newKey;
    await loadCustomers();
    if (typeof loadProfitReport === 'function') loadProfitReport();
  };

  // ─── CUSTOMER PAYS CREDIT ───
  window.custPayPreview = function () {
    const a = accounts.find(x => x.key === selectedKey);
    const el = document.getElementById('cp-preview');
    if (!a || !el) return;
    const amt = parseFloat(document.getElementById('cp-amt').value) || 0;
    el.innerHTML = amt > 0
      ? `Credit: ${money(a.balance)} → <span style="color:#1a7f37;">${money(a.balance - amt)}</span> (reduced by ${money(amt)})`
      : `Credit now: ${money(a.balance)}`;
  };

  window.custPayCredit = async function () {
    const a = accounts.find(x => x.key === selectedKey);
    if (!a) return;
    const errEl = document.getElementById('cp-err');
    errEl.style.display = 'none';
    const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };

    const amount = parseFloat(document.getElementById('cp-amt').value);
    const method = document.getElementById('cp-via').value;
    const day = document.getElementById('cp-date').value;
    if (!amount || amount <= 0) return showErr('Enter the amount paid.');
    if (amount > a.balance) return showErr(`That is more than the credit remaining (${money(a.balance)}).`);
    if (!day) return showErr('Pick the date paid.');
    if (!navigator.onLine) return showErr('Recording a payment needs internet.');

    const [y, m, d] = day.split('-').map(Number);
    const now = new Date();
    const createdAt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
    const { error } = await supabaseClient.from('lorry_customer_ledger').insert([{
      customer_name: a.name, location: a.location || null,
      entry_type: 'payment', amount, method, paid_at_order: false, staff_id: currentStaff.id, created_at: createdAt
    }]);
    if (error) return showErr('Error: ' + error.message);

    await loadCustomers();
    alert(`✅ ${money(amount)} received from ${a.name}. Credit remaining: ${money(a.balance - amount)}.`);
  };

  // Fix a typo: change the amount, method or date of an entry (admin)
  window.custEditEntry = async function (id) {
    let entry = null, acct = null;
    accounts.forEach(a => a.entries.forEach(e => { if (e.id === id) { entry = e; acct = a; } }));
    if (!entry) return;
    const isDel = entry.entry_type === 'delivery';

    const amtAns = prompt(`${acct.name}\n${isDel ? 'Order total' : 'Payment amount'} (Ksh):`, entry.amount);
    if (amtAns === null) return;
    const amount = parseFloat(amtAns);
    if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }

    let method = entry.method;
    if (!isDel) {
      const mAns = prompt('Paid by? Type: cash or mpesa', entry.method || 'cash');
      if (mAns === null) return;
      method = mAns.trim().toLowerCase();
      if (!['cash', 'mpesa'].includes(method)) { alert('Please type cash or mpesa.'); return; }
    }

    const dayAns = prompt('Date (YYYY-MM-DD):', localISO(new Date(entry.created_at)));
    if (dayAns === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayAns.trim())) { alert('Use the format YYYY-MM-DD, e.g. 2026-11-18.'); return; }

    const delivered = acct.delivered + (isDel ? amount - Number(entry.amount) : 0);
    const paid = acct.paid + (isDel ? 0 : amount - Number(entry.amount));
    if (paid > delivered) { alert('Payments cannot be more than the total ordered. Check the amount.'); return; }
    if (isDel && entry.items && entry.items.length && !confirm('This order has a product list. Only the total will change — the product list stays as it is. Continue?')) return;
    if (!navigator.onLine) { alert('Editing needs internet.'); return; }

    const orig = new Date(entry.created_at);
    const [y, m, d] = dayAns.trim().split('-').map(Number);
    const patch = { amount, created_at: new Date(y, m - 1, d, orig.getHours(), orig.getMinutes(), orig.getSeconds()).toISOString() };
    if (!isDel) patch.method = method;
    const { error } = await supabaseClient.from('lorry_customer_ledger').update(patch).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    await loadCustomers();
  };

  window.custDeleteEntry = async function (id) {
    if (!confirm('Delete this entry from the account?\n(Stock and the Profit Report are NOT changed.)')) return;
    const { error } = await supabaseClient.from('lorry_customer_ledger').delete().eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    await loadCustomers();
  };

  // ─── ADD PAST RECORD (back-dated; account only — no stock or Profit Report change) ───
  window.custTogglePast = function () {
    const f = document.getElementById('cust-past');
    const open = f.style.display === 'none';
    f.style.display = open ? 'block' : 'none';
    if (!open) return;
    document.getElementById('cust-products').innerHTML =
      storeProducts.map(p => `<option value="${escapeAttr(displayName(p))}">`).join('');
    if (!document.getElementById('past-date').value) document.getElementById('past-date').value = todayDateInputValue();
    custPastRecalc();
  };

  // optional product lines
  window.custPastAddLine = function () {
    const row = document.createElement('div');
    row.className = 'past-line';
    row.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px;';
    row.innerHTML = `
      <input type="text" class="pl-name" list="cust-products" placeholder="Product" autocomplete="off" style="flex:2; min-width:160px;">
      <input type="number" class="pl-qty" min="0" step="any" placeholder="Qty" style="width:70px;">
      <input type="number" class="pl-price" min="0" step="any" placeholder="Price" style="width:100px;">
      <button class="secondary" type="button" onclick="this.parentNode.remove(); custPastTotal();">✕</button>`;
    document.getElementById('past-lines').appendChild(row);
  };

  function pastLines() {
    return Array.from(document.querySelectorAll('#past-lines .past-line')).map(r => ({
      name: r.querySelector('.pl-name').value.trim(),
      qty: parseFloat(r.querySelector('.pl-qty').value),
      price: parseFloat(r.querySelector('.pl-price').value)
    })).filter(l => l.name || l.qty || l.price);
  }

  // product lines fill the order total (you can still edit it)
  window.custPastTotal = function () {
    const t = pastLines().reduce((s, l) => s + ((l.qty > 0 && l.price >= 0) ? l.qty * l.price : 0), 0);
    if (t > 0) document.getElementById('past-total-input').value = t;
    custPastRecalc();
  };

  // successive credit payments
  window.custPastAddPay = function () {
    const row = document.createElement('div');
    row.className = 'past-pay';
    row.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px;';
    row.innerHTML = `
      <input type="date" class="pp-date" style="flex:1; min-width:140px;">
      <input type="number" class="pp-amt" min="0" step="any" placeholder="Amount" style="flex:1; min-width:100px;">
      <select class="pp-via" style="flex:1; min-width:90px;"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select>
      <button class="secondary" type="button" onclick="this.parentNode.remove(); custPastRecalc();">✕</button>`;
    document.getElementById('past-credit-pays').appendChild(row);
  };

  function pastPays() {
    return Array.from(document.querySelectorAll('#past-credit-pays .past-pay')).map(r => ({
      day: r.querySelector('.pp-date').value,
      amount: parseFloat(r.querySelector('.pp-amt').value),
      method: r.querySelector('.pp-via').value
    })).filter(p => p.day || p.amount);
  }

  window.custPastRecalc = function () {
    const total = parseFloat(document.getElementById('past-total-input').value) || 0;
    const paidDay = parseFloat(document.getElementById('past-del-paid').value) || 0;
    const later = pastPays().reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
    const afterDay = total - paidDay, remaining = afterDay - later;
    document.getElementById('past-credit').textContent = money(afterDay);
    const rem = document.getElementById('past-remaining');
    rem.textContent = money(remaining);
    rem.style.color = remaining < 0 ? '#c0392b' : (remaining === 0 ? '#1a7f37' : '#c0392b');
  };

  window.custSavePast = async function () {
    const errEl = document.getElementById('past-err');
    errEl.style.display = 'none';
    const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };

    const name = document.getElementById('past-name').value.trim();
    const day = document.getElementById('past-date').value;
    const total = parseFloat(document.getElementById('past-total-input').value);
    const paidDay = parseFloat(document.getElementById('past-del-paid').value) || 0;
    const via = document.getElementById('past-del-via').value;
    if (!name) return showErr('Enter the customer name.');
    if (!day) return showErr('Pick the order date.');
    if (!total || total <= 0) return showErr('Enter the order total.');
    if (paidDay < 0 || paidDay > total) return showErr(`Paid on the order day must be between 0 and ${money(total)}.`);

    const lines = pastLines();
    for (const l of lines) {
      if (!l.name || !l.qty || l.qty <= 0 || isNaN(l.price) || l.price < 0) return showErr('Finish or remove the incomplete product line.');
    }
    const pays = pastPays();
    for (const p of pays) {
      if (!p.day) return showErr('Every credit payment needs a date.');
      if (!p.amount || p.amount <= 0) return showErr('Every credit payment needs an amount.');
      if (p.day < day) return showErr(`A credit payment is dated before the order date (${formatLedgerDate(day)}).`);
    }
    const laterTotal = pays.reduce((s, p) => s + p.amount, 0);
    if (laterTotal > total - paidDay) return showErr(`Credit payments (${money(laterTotal)}) are more than the credit (${money(total - paidDay)}).`);
    if (!navigator.onLine) return showErr('Saving needs internet.');

    // each entry keeps its chosen day; the current time of day keeps same-day entries in order
    const now = new Date();
    const at = (iso, plusSec) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds() + plusSec).toISOString();
    };
    const common = { customer_name: name, staff_id: currentStaff.id };
    const rows = [{
      ...common, entry_type: 'delivery', paid_at_order: false, amount: total, created_at: at(day, 0),
      items: lines.length ? lines.map(l => ({ name: l.name, qty: l.qty, price: l.price })) : null
    }];
    if (paidDay > 0) rows.push({ ...common, entry_type: 'payment', amount: paidDay, method: via, paid_at_order: true, created_at: at(day, 1) });
    pays.slice().sort((x, y) => x.day.localeCompare(y.day)).forEach((p, i) => {
      rows.push({ ...common, entry_type: 'payment', amount: p.amount, method: p.method, paid_at_order: false, created_at: at(p.day, 2 + i) });
    });

    const { error } = await supabaseClient.from('lorry_customer_ledger').insert(rows);
    if (error) return showErr('Error: ' + error.message);
    selectedKey = keyOf(name);

    // clear for the next record (the customer name stays so you can add their next order)
    document.getElementById('past-lines').innerHTML = '';
    document.getElementById('past-credit-pays').innerHTML = '';
    ['past-total-input', 'past-del-paid'].forEach(id => document.getElementById(id).value = '');
    custPastRecalc();
    await loadCustomers();
    alert(`✅ Past record saved for ${name} — credit remaining ${money(total - paidDay - laterTotal)}. You can add another order for the same customer.`);
  };

  // ─── WIRING ───
  const origRender = window.renderLorryStock;
  window.renderLorryStock = function () { origRender.apply(this, arguments); renderItems(); };

  const wait = setInterval(() => {
    if (typeof currentStaff !== 'undefined' && currentStaff) { clearInterval(wait); loadCustomers(); }
  }, 300);
})();
