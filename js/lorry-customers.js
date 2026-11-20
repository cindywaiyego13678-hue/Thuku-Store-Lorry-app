/* ------------------------------------------------------------------
   lorry-customers.js — Customer Accounts
   One account per customer: every delivery (products, qty, price),
   every payment (cash / M-Pesa) and the credit balance, each with a date.
   Balance = total delivered − total paid.
   Saving a delivery also takes the stock off the lorry and records the
   sales, so the Profit Report stays correct.
   Requires lorry-customer-ledger.sql (run once in Supabase).
------------------------------------------------------------------- */
(function () {
  let accounts = [];      // grouped customers
  let custQty = {}, custPrice = {};
  let deliveryTotal = 0;

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
        <div class="field" style="flex:1; min-width:130px;"><label>Phone</label><input type="tel" id="cust-phone" placeholder="07xx xxx xxx"></div>
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

    <div class="field"><input type="text" id="cust-search" placeholder="Search customers..." autocomplete="off"></div>
    <div id="cust-owed" style="margin:6px 0 10px; font-weight:800; color:#c0392b;"></div>
    <div id="cust-list"><div class="empty-state">Loading...</div></div>
  `;
  reportCard.parentNode.insertBefore(card, reportCard);
  document.getElementById('cust-search').addEventListener('input', renderAccounts);

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
    if (!document.getElementById('cust-phone').value) document.getElementById('cust-phone').value = a.phone || '';
    if (!document.getElementById('cust-location').value) document.getElementById('cust-location').value = a.location || '';
  };

  // ─── SAVE DELIVERY ───
  window.custSaveDelivery = async function () {
    const errEl = document.getElementById('cust-error');
    errEl.style.display = 'none';
    const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };

    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
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
    if (paidNow < total && !phone) return showErr('Enter the customer phone — part of this delivery is on credit.');
    if (!navigator.onLine) return showErr('Saving a delivery needs internet.');

    const saleMethod = paidNow >= total ? via : (paidNow > 0 ? 'mixed' : 'credit');
    if (!confirm(`${name}\n${lines.length} item(s), total ${money(total)}\nPaid now: ${money(paidNow)} (${via})\nOn credit: ${money(total - paidNow)}\n\nSave this delivery?`)) return;

    const okLines = [], failed = [];
    for (const l of lines) {
      const { error } = await supabaseClient.rpc('record_lorry_sale', {
        p_store_product_id: l.row.store_product_id, p_quantity: l.qty, p_unit_price: l.price,
        p_customer_name: name, p_customer_phone: phone || null, p_payment_method: saleMethod,
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
      customer_name: name, phone: phone || null, location: location || null, entry_type: 'delivery',
      items: okLines.map(l => ({ name: l.label, qty: l.qty, price: l.price })),
      amount: okTotal, staff_id: currentStaff.id, created_at: now.toISOString()
    }];
    if (paid > 0) rows.push({
      customer_name: name, phone: phone || null, location: location || null, entry_type: 'payment',
      amount: paid, method: via, staff_id: currentStaff.id, created_at: new Date(now.getTime() + 1000).toISOString()
    });
    const { error: ledErr } = await supabaseClient.from('lorry_customer_ledger').insert(rows);
    okLines.forEach(l => { delete custQty[l.row.store_product_id]; delete custPrice[l.row.store_product_id]; });

    await Promise.all([loadLorryStock(), loadProfitReport()]);
    if (typeof loadWeekly === 'function') loadWeekly();
    await loadCustomers();

    if (ledErr) return showErr(`Stock was taken off the lorry but the account entry FAILED: ${ledErr.message}. Add it manually: ${name}, ${money(okTotal)}, paid ${money(paid)}.`);
    if (failed.length) return showErr(`Saved ${okLines.length} item(s). Not saved: ${failed.join('; ')}.`);

    ['cust-name', 'cust-phone', 'cust-location', 'cust-paid'].forEach(id => document.getElementById(id).value = '');
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
      const a = map[k] = map[k] || { key: k, name: e.customer_name, phone: '', location: '', entries: [], delivered: 0, paid: 0 };
      a.name = e.customer_name;
      if (e.phone) a.phone = e.phone;
      if (e.location) a.location = e.location;
      a.entries.push(e);
      if (e.entry_type === 'delivery') a.delivered += Number(e.amount); else a.paid += Number(e.amount);
    });
    accounts = Object.values(map).map(a => ({ ...a, balance: a.delivered - a.paid }))
      .sort((x, y) => (y.balance > 0) - (x.balance > 0) || x.name.localeCompare(y.name));

    document.getElementById('cust-names').innerHTML = accounts.map(a => `<option value="${escapeAttr(a.name)}">`).join('');
    renderAccounts();
  };

  function renderAccounts() {
    const listEl = document.getElementById('cust-list');
    const q = document.getElementById('cust-search').value.trim().toLowerCase();
    const shown = accounts.filter(a => !q || a.name.toLowerCase().includes(q) || (a.phone || '').includes(q));
    const owed = accounts.reduce((s, a) => s + Math.max(a.balance, 0), 0);
    document.getElementById('cust-owed').textContent = accounts.length ? `Total owed by customers: ${money(owed)}` : '';
    if (!shown.length) { listEl.innerHTML = `<div class="empty-state">${accounts.length ? 'No match.' : 'No customer accounts yet. Use + New Delivery.'}</div>`; return; }

    const canDelete = currentStaff && currentStaff.role === 'admin';
    listEl.innerHTML = shown.map(a => {
      let run = 0;
      const sorted = a.entries.slice().sort((x, y) => new Date(x.created_at) - new Date(y.created_at) || (x.entry_type === 'delivery' ? -1 : 1));
      const rows = sorted.map(e => {
        const isDel = e.entry_type === 'delivery';
        run += isDel ? Number(e.amount) : -Number(e.amount);
        const details = isDel
          ? (e.items || []).map(i => `${i.qty} × ${escapeHtml(i.name)} @ ${Math.round(i.price).toLocaleString()}`).join('<br>')
          : 'Payment received';
        return `<tr>
          <td>${fmtDate(e.created_at)}</td>
          <td>${details}</td>
          <td>${isDel ? '—' : (e.method === 'mpesa' ? 'M-Pesa' : 'Cash')}</td>
          <td>${isDel ? money(e.amount) : ''}</td>
          <td style="color:#1a7f37;">${isDel ? '' : money(e.amount)}</td>
          <td style="font-weight:700;">${money(run)}</td>
          ${canDelete ? `<td><button class="secondary" onclick="custDeleteEntry('${e.id}')">✕</button></td>` : ''}
        </tr>`;
      }).join('');
      const i = accounts.indexOf(a);
      return `<details style="border:1px solid var(--border, #33455c); border-radius:8px; padding:10px 12px; margin-bottom:10px;">
        <summary style="cursor:pointer; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
          <span><b>${escapeHtml(a.name)}</b>
            <span style="color:var(--muted); font-size:0.8rem;">${a.phone ? ' · 📞 ' + escapeHtml(a.phone) : ''}${a.location ? ' · 📍 ' + escapeHtml(a.location) : ''}</span></span>
          <span style="font-weight:800; color:${a.balance > 0 ? '#c0392b' : '#1a7f37'};">${a.balance > 0 ? 'Owes ' + money(a.balance) : 'Cleared'}</span>
        </summary>
        <div style="margin-top:8px; font-size:0.85rem; color:var(--muted);">
          Delivered ${money(a.delivered)} · Paid ${money(a.paid)} · Balance ${money(a.balance)}
        </div>
        <div style="overflow-x:auto;"><table style="margin-top:8px;">
          <thead><tr><th>Date</th><th>Products / Details</th><th>Method</th><th>Delivered</th><th>Paid</th><th>Balance</th>${canDelete ? '<th></th>' : ''}</tr></thead>
          <tbody>${rows}</tbody></table></div>
        ${a.balance > 0 ? `<button style="margin-top:8px;" onclick="custRecordPayment(${i})">+ Record Payment</button>` : ''}
      </details>`;
    }).join('');
  }

  // ─── RECORD PAYMENT (dated) ───
  window.custRecordPayment = async function (i) {
    const a = accounts[i];
    if (!a) return;
    const amtAns = prompt(`${a.name}\nBalance: ${money(a.balance)}\n\nAmount paid (Ksh):`, Math.round(a.balance));
    if (amtAns === null) return;
    const amount = parseFloat(amtAns);
    if (isNaN(amount) || amount <= 0) { alert('Enter a valid amount.'); return; }
    if (amount > a.balance) { alert(`That is more than the balance (${money(a.balance)}).`); return; }

    const methAns = prompt('Paid by? Type: cash or mpesa', 'cash');
    if (methAns === null) return;
    const method = methAns.trim().toLowerCase();
    if (!['cash', 'mpesa'].includes(method)) { alert('Please type cash or mpesa.'); return; }

    const dateAns = prompt('Date paid (YYYY-MM-DD):', todayDateInputValue());
    if (dateAns === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateAns.trim())) { alert('Use the format YYYY-MM-DD, e.g. 2026-11-20.'); return; }
    const [y, m, d] = dateAns.trim().split('-').map(Number);
    const now = new Date();
    const createdAt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
    if (!navigator.onLine) { alert('Recording a payment needs internet.'); return; }

    const { error } = await supabaseClient.from('lorry_customer_ledger').insert([{
      customer_name: a.name, phone: a.phone || null, location: a.location || null,
      entry_type: 'payment', amount, method, staff_id: currentStaff.id, created_at: createdAt
    }]);
    if (error) { alert('Error: ' + error.message); return; }
    await loadCustomers();
  };

  window.custDeleteEntry = async function (id) {
    if (!confirm('Delete this entry from the account?\n(Stock and the Profit Report are NOT changed.)')) return;
    const { error } = await supabaseClient.from('lorry_customer_ledger').delete().eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    await loadCustomers();
  };

  // ─── WIRING ───
  const origRender = window.renderLorryStock;
  window.renderLorryStock = function () { origRender.apply(this, arguments); renderItems(); };

  const wait = setInterval(() => {
    if (typeof currentStaff !== 'undefined' && currentStaff) { clearInterval(wait); loadCustomers(); }
  }, 300);
})();
