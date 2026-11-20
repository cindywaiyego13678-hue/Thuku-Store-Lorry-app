/* ------------------------------------------------------------------
   lorry-deliveries.js
   Per-customer delivery sales for the lorry (mattresses, duvets, etc.)
   - Each customer gets their own sale: name, phone, location, payment method
   - Payment methods: Cash, M-Pesa, Card, Credit (pay later),
     or Part paid (some paid now, balance on credit)
   - Credit sales are tracked per customer in a "Customers Owing" list.
     Customers can pay the balance in instalments; when it reaches zero
     the account is closed out automatically.

   Requires the table from lorry-credit-payments.sql (run once in Supabase).

   Add ONE line to lorry.html, just before </body>, AFTER the big inline <script>:
     <script src="js/lorry-deliveries.js"></script>
------------------------------------------------------------------- */
(function () {
  let deliveryQty = {};     // { store_product_id: qty }
  let deliveryPrice = {};   // { store_product_id: price override }
  let creditGroups = [];    // grouped unpaid credit sales
  let deliveryTotalNow = 0; // current delivery total (used for part-payment balance)

  const money = (n) => 'Ksh ' + Math.round(Number(n) || 0).toLocaleString();

  // ───────────────────────── UI INJECTION ─────────────────────────
  function injectCards() {
    // 1) Delivery card — placed just above "Close Route"
    const closeCard = document.getElementById('close-route-payment').closest('.card');
    const delivery = document.createElement('div');
    delivery.className = 'card';
    delivery.id = 'delivery-card';
    delivery.style.marginBottom = '18px';
    delivery.innerHTML = `
      <h3 style="margin-top:0;">🛏️ Record Delivery (Per Customer)</h3>
      <p style="color:var(--muted); font-size:0.85rem; margin-top:-8px;">
        One customer at a time. Enter who it is, where, how they paid (or Credit), then the items delivered.
        Items are taken off the lorry straight away, so they won't be counted again at Close Route.
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:160px;"><label>Customer name *</label>
          <input type="text" id="dlv-name" placeholder="e.g. Mary Wanjiru" autocomplete="off"></div>
        <div class="field" style="flex:1; min-width:140px;"><label>Phone</label>
          <input type="tel" id="dlv-phone" placeholder="07xx xxx xxx" autocomplete="off"></div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:160px;"><label>Delivery location *</label>
          <input type="text" id="dlv-location" placeholder="e.g. Kasarani, Mwiki" autocomplete="off"></div>
        <div class="field" style="flex:1; min-width:140px;"><label>Payment</label>
          <select id="dlv-payment">
            <option value="cash">Cash (paid)</option>
            <option value="mpesa">M-Pesa (paid)</option>
            <option value="card">Card (paid)</option>
            <option value="credit">Credit — pay later</option>
            <option value="part">Part paid — balance on credit</option>
          </select></div>
      </div>
      <p id="dlv-credit-note" style="display:none; color:#c0392b; font-size:0.85rem; margin:0 0 8px;">
        ⚠ Not paid yet — this will be added to the customer's balance under "Customers Owing".
      </p>
      <div id="dlv-part-box" style="display:none; border:1px solid var(--border, #33455c); border-radius:8px; padding:10px 12px; margin-bottom:10px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div class="field" style="flex:1; min-width:140px;"><label>Amount paid now (Ksh)</label>
            <input type="number" id="dlv-paid-now" min="0" step="any" placeholder="0" oninput="deliveryUpdateBalance()"></div>
          <div class="field" style="flex:1; min-width:140px;"><label>Paid via</label>
            <select id="dlv-paid-via">
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa</option>
              <option value="card">Card</option>
            </select></div>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--muted); font-size:0.85rem;">Balance on credit</span>
          <strong id="dlv-balance" style="color:#c0392b;">Ksh 0</strong>
        </div>
      </div>
      <div id="dlv-items" style="max-height:300px; overflow-y:auto; border:1px solid var(--border, #e2e6ea); border-radius:8px;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin:10px 0;">
        <span style="color:var(--muted); font-size:0.85rem;">Delivery total</span>
        <strong id="dlv-total" style="font-size:1.1rem;">Ksh 0</strong>
      </div>
      <button onclick="saveDelivery()" style="width:100%;">Save Delivery</button>
      <p class="error-text" id="dlv-error" style="display:none;"></p>
    `;
    closeCard.parentNode.insertBefore(delivery, closeCard);

    document.getElementById('dlv-payment').addEventListener('change', (e) => {
      const v = e.target.value;
      document.getElementById('dlv-credit-note').style.display = v === 'credit' ? 'block' : 'none';
      document.getElementById('dlv-part-box').style.display = v === 'part' ? 'block' : 'none';
      updateDeliveryTotal();
    });

    // 2) Credit card — placed just above the Profit Report
    const reportCard = document.getElementById('profit-report-date').closest('.card');
    const credit = document.createElement('div');
    credit.className = 'card';
    credit.id = 'credit-card';
    credit.style.marginBottom = '18px';
    credit.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <h3 style="margin:0;">💳 Customers Owing (Credit)</h3>
        <button class="secondary" onclick="loadCredit()">Refresh</button>
      </div>
      <div id="credit-total" style="margin:10px 0; font-weight:800; font-size:1.1rem; color:#c0392b;"></div>
      <div id="credit-list"><div class="empty-state">Loading...</div></div>
    `;
    reportCard.parentNode.insertBefore(credit, reportCard);
  }

  // ───────────────────────── DELIVERY ITEMS ─────────────────────────
  function priceFor(row) {
    if (deliveryPrice[row.store_product_id] !== undefined) return deliveryPrice[row.store_product_id];
    if (typeof closeRoutePrices !== 'undefined' && closeRoutePrices[row.store_product_id] !== undefined)
      return closeRoutePrices[row.store_product_id];
    return (row.store_products || {}).price ?? 0;
  }

  function renderDeliveryItems() {
    const el = document.getElementById('dlv-items');
    if (!el) return;
    if (!lorryStock.length) {
      el.innerHTML = '<div class="empty-state">Nothing on the lorry — load stock first.</div>';
      updateDeliveryTotal();
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Product</th><th>On Lorry</th><th>Qty</th><th>Price (Ksh)</th></tr></thead>
        <tbody>
          ${lorryStock.map(r => `
            <tr>
              <td>${escapeHtml(displayName(r.store_products || {}))}</td>
              <td><span class="badge in_stock">${r.quantity}</span></td>
              <td><input type="number" min="0" step="any" style="width:70px;" placeholder="0"
                    value="${deliveryQty[r.store_product_id] ?? ''}"
                    oninput="deliverySetQty('${r.store_product_id}', this.value)"></td>
              <td><input type="number" min="0" step="any" style="width:90px;"
                    value="${priceFor(r)}"
                    oninput="deliverySetPrice('${r.store_product_id}', this.value)"></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    updateDeliveryTotal();
  }

  function updateDeliveryTotal() {
    const totalEl = document.getElementById('dlv-total');
    if (!totalEl) return;
    let total = 0;
    lorryStock.forEach(r => {
      const q = Number(deliveryQty[r.store_product_id]) || 0;
      if (q > 0) total += q * (Number(priceFor(r)) || 0);
    });
    deliveryTotalNow = total;
    totalEl.textContent = money(total);
    window.deliveryUpdateBalance();
  }

  window.deliveryUpdateBalance = function () {
    const el = document.getElementById('dlv-balance');
    const paidEl = document.getElementById('dlv-paid-now');
    if (!el || !paidEl) return;
    const paid = parseFloat(paidEl.value) || 0;
    el.textContent = money(Math.max(deliveryTotalNow - paid, 0));
  };

  window.deliverySetQty = function (id, v) {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) delete deliveryQty[id]; else deliveryQty[id] = n;
    updateDeliveryTotal();
  };
  window.deliverySetPrice = function (id, v) {
    const n = parseFloat(v);
    deliveryPrice[id] = isNaN(n) ? 0 : n;
    updateDeliveryTotal();
  };

  // ───────────────────────── SAVE DELIVERY ─────────────────────────
  window.saveDelivery = async function () {
    const errorEl = document.getElementById('dlv-error');
    errorEl.style.display = 'none';
    const showErr = (m) => { errorEl.textContent = m; errorEl.style.display = 'block'; };

    const name = document.getElementById('dlv-name').value.trim();
    const phone = document.getElementById('dlv-phone').value.trim();
    const location = document.getElementById('dlv-location').value.trim();
    const method = document.getElementById('dlv-payment').value;

    if (!name) return showErr('Enter the customer name.');
    if (!location) return showErr('Enter the delivery location.');

    const lines = [];
    for (const r of lorryStock) {
      const qty = Number(deliveryQty[r.store_product_id]) || 0;
      if (qty <= 0) continue;
      const label = displayName(r.store_products || {});
      const price = parseFloat(priceFor(r));
      if (qty > Number(r.quantity)) return showErr(`Only ${r.quantity} of ${label} on the lorry.`);
      if (!price || price <= 0) return showErr(`Enter a valid price for ${label}.`);
      lines.push({ row: r, qty, price, label });
    }
    if (!lines.length) return showErr('Enter a quantity for at least one item delivered.');
    if (!navigator.onLine) return showErr('Saving a delivery needs internet (it updates live lorry stock).');

    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

    // Part payment: validate the amount paid now
    let paidNow = 0, paidVia = null;
    if (method === 'part') {
      paidNow = parseFloat(document.getElementById('dlv-paid-now').value) || 0;
      paidVia = document.getElementById('dlv-paid-via').value;
      if (paidNow <= 0 || paidNow >= total) {
        return showErr(`Amount paid now must be more than 0 and less than the total (${money(total)}).`);
      }
      if (!phone) return showErr('Enter the customer phone — part of this sale is on credit.');
    }
    // A part-paid sale is stored as a normal credit sale; the amount paid goes in lorry_credit_payments
    const saleMethod = method === 'part' ? 'credit' : method;

    const methodText = method === 'credit' ? 'ON CREDIT (not paid)'
      : method === 'part' ? `PART PAID: ${money(paidNow)} by ${paidVia.toUpperCase()}, balance ${money(total - paidNow)} ON CREDIT`
      : `paid by ${method.toUpperCase()}`;
    if (!confirm(`${name} — ${location}\n${lines.length} item(s), total ${money(total)}\n${methodText}\n\nSave this delivery?`)) return;

    // Location is kept with the name so it shows in the sales list and the credit list
    const customerLabel = `${name} (${location})`;

    let ok = 0;
    const failed = [];
    for (const l of lines) {
      const { error } = await supabaseClient.rpc('record_lorry_sale', {
        p_store_product_id: l.row.store_product_id,
        p_quantity: l.qty,
        p_unit_price: l.price,
        p_customer_name: customerLabel,
        p_customer_phone: phone || null,
        p_payment_method: saleMethod,
        p_staff_id: currentStaff.id,
        p_synced: true
      });
      if (error) { failed.push(`${l.label}: ${error.message}`); continue; }
      delete deliveryQty[l.row.store_product_id];
      delete deliveryPrice[l.row.store_product_id];
      ok++;
    }

    // Record the part payment once, if at least one item was saved
    if (method === 'part' && ok > 0) {
      const { error: payErr } = await supabaseClient.from('lorry_credit_payments').insert([{
        customer_name: customerLabel, amount: paidNow, method: paidVia, staff_id: currentStaff.id
      }]);
      if (payErr) failed.push(`Payment of ${money(paidNow)} was NOT recorded: ${payErr.message}`);
    }

    await loadLorryStock();
    await loadProfitReport();

    if (failed.length) {
      showErr(`Saved ${ok} item(s). Not saved: ${failed.join('; ')}. Fix and press Save again — saved items won't be repeated. ` +
        (method === 'part' ? 'For the failed items, save them as plain Credit (the part payment is already recorded).' : ''));
      return;
    }
    document.getElementById('dlv-name').value = '';
    document.getElementById('dlv-phone').value = '';
    document.getElementById('dlv-location').value = '';
    document.getElementById('dlv-payment').value = 'cash';
    document.getElementById('dlv-credit-note').style.display = 'none';
    document.getElementById('dlv-part-box').style.display = 'none';
    document.getElementById('dlv-paid-now').value = '';
    renderDeliveryItems();
    alert(`✅ Delivery saved for ${name} — ` + (
      method === 'credit' ? `${money(total)} added to credit.`
      : method === 'part' ? `${money(paidNow)} received, ${money(total - paidNow)} added to credit.`
      : `${money(total)} received.`));
  };

  // ───────────────────────── CREDIT TRACKING ─────────────────────────
  window.loadCredit = async function () {
    const listEl = document.getElementById('credit-list');
    const totalEl = document.getElementById('credit-total');
    if (!listEl) return;
    if (!navigator.onLine) { listEl.innerHTML = '<div class="empty-state">Credit list needs internet.</div>'; return; }

    const { data, error } = await supabaseClient
      .from('lorry_sales')
      .select('*, store_products(name, size, manufacturer, density)')
      .eq('payment_method', 'credit')
      .order('created_at', { ascending: false });
    if (error) { listEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(error.message)}</div>`; return; }

    const { data: pays, error: payErr } = await supabaseClient
      .from('lorry_credit_payments').select('*').eq('settled', false)
      .order('created_at', { ascending: false });
    if (payErr) { listEl.innerHTML = `<div class="empty-state">Error: ${escapeHtml(payErr.message)}</div>`; return; }

    const groups = {};
    (data || []).forEach(s => {
      const key = s.customer_name || 'Unknown customer';
      if (!groups[key]) groups[key] = { name: key, phone: s.customer_phone || '', sales: [], payments: [], total: 0, paid: 0 };
      groups[key].sales.push(s);
      groups[key].total += Number(s.quantity) * Number(s.unit_price);
      if (!groups[key].phone && s.customer_phone) groups[key].phone = s.customer_phone;
    });
    (pays || []).forEach(p => {
      if (!groups[p.customer_name]) return;
      groups[p.customer_name].payments.push(p);
      groups[p.customer_name].paid += Number(p.amount);
    });
    creditGroups = Object.values(groups).map(g => ({ ...g, balance: Math.max(g.total - g.paid, 0) }));

    if (!creditGroups.length) {
      totalEl.textContent = '';
      listEl.innerHTML = '<div class="empty-state">No customers owing. 🎉</div>';
      return;
    }

    const grand = creditGroups.reduce((s, g) => s + g.balance, 0);
    totalEl.textContent = `Total owed: ${money(grand)}`;

    listEl.innerHTML = creditGroups.map((g, i) => `
      <div style="border:1px solid var(--border, #33455c); border-radius:8px; padding:10px 12px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;">${escapeHtml(g.name)}</div>
            ${g.phone ? `<div style="color:var(--muted); font-size:0.8rem;">📞 ${escapeHtml(g.phone)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            ${g.paid > 0 ? `<div style="color:var(--muted); font-size:0.8rem;">Total ${money(g.total)} · Paid ${money(g.paid)}</div>` : ''}
            <div style="font-weight:800; color:#c0392b;">Balance ${money(g.balance)}</div>
            <button style="margin-top:4px;" onclick="markCreditPaid(${i})">Record Payment</button>
          </div>
        </div>
        <table style="margin-top:8px;">
          <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>
            ${g.sales.map(s => {
              const p = s.store_products || {};
              const d = new Date(s.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
              return `<tr>
                <td>${d}</td>
                <td>${escapeHtml(displayName(p) || s.product_name || '—')}</td>
                <td>${s.quantity}</td>
                <td>${Number(s.unit_price).toLocaleString()}</td>
                <td>${(Number(s.quantity) * Number(s.unit_price)).toLocaleString()}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${g.payments.length ? `
        <div style="margin-top:8px; font-size:0.85rem;">
          <b>Payments received</b>
          ${g.payments.map(p => `<div>${new Date(p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} — ${money(p.amount)} (${escapeHtml(p.method)})</div>`).join('')}
        </div>` : ''}
      </div>`).join('');
  };

  window.markCreditPaid = async function (i) {
    const g = creditGroups[i];
    if (!g) return;
    const amtAns = prompt(`${g.name}\nBalance: ${money(g.balance)}\n\nHow much are they paying now? (Ksh)`, Math.round(g.balance));
    if (amtAns === null) return;
    const amount = parseFloat(amtAns);
    if (isNaN(amount) || amount <= 0) { alert('Enter a valid amount.'); return; }
    if (amount > g.balance) { alert(`That is more than the balance (${money(g.balance)}).`); return; }

    const methAns = prompt('How did they pay? Type: cash, mpesa or card', 'cash');
    if (methAns === null) return;
    const method = methAns.trim().toLowerCase();
    if (!['cash', 'mpesa', 'card'].includes(method)) { alert('Please type cash, mpesa or card.'); return; }
    if (!navigator.onLine) { alert('Recording a payment needs internet.'); return; }

    const { error } = await supabaseClient.from('lorry_credit_payments').insert([{
      customer_name: g.name, amount, method, staff_id: currentStaff.id
    }]);
    if (error) { alert('Error: ' + error.message); return; }

    // Fully paid → close out: sales become paid, payments are marked settled
    if (amount >= g.balance - 0.5) {
      const ids = g.sales.map(s => s.id);
      const { error: e1 } = await supabaseClient.from('lorry_sales').update({ payment_method: method }).in('id', ids);
      if (e1) { alert('Payment saved, but could not close the account: ' + e1.message); return; }
      await supabaseClient.from('lorry_credit_payments').update({ settled: true })
        .eq('customer_name', g.name).eq('settled', false);
      alert(`✅ ${g.name} has paid in full.`);
    } else {
      alert(`✅ ${money(amount)} received. Remaining balance: ${money(g.balance - amount)}.`);
    }
    await loadCredit();
    await loadProfitReport();
  };

  // ───────────────────────── WIRING ─────────────────────────
  injectCards();

  // Keep the delivery item list in sync whenever lorry stock re-renders
  const origRenderLorryStock = window.renderLorryStock;
  window.renderLorryStock = function () {
    origRenderLorryStock.apply(this, arguments);
    renderDeliveryItems();
  };

  // Refresh the credit list whenever the profit report refreshes
  const origLoadProfitReport = window.loadProfitReport;
  window.loadProfitReport = function () {
    window.loadCredit();
    return origLoadProfitReport.apply(this, arguments);
  };

  renderDeliveryItems();
})();
