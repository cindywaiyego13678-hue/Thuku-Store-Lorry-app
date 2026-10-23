/* ------------------------------------------------------------------
   lorry-deliveries.js
   Per-customer delivery sales for the lorry (mattresses, duvets, etc.)
   - Each customer gets their own sale: name, phone, location, payment method
   - Payment methods: Cash, M-Pesa, Card, or Credit (pay later)
   - Credit sales are tracked per customer in a "Customers Owing" list,
     and can be marked as paid when the customer settles.

   Add ONE line to lorry.html, just before </body>, AFTER the big inline <script>:
     <script src="js/lorry-deliveries.js"></script>
------------------------------------------------------------------- */
(function () {
  let deliveryQty = {};     // { store_product_id: qty }
  let deliveryPrice = {};   // { store_product_id: price override }
  let creditGroups = [];    // grouped unpaid credit sales

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
          </select></div>
      </div>
      <p id="dlv-credit-note" style="display:none; color:#c0392b; font-size:0.85rem; margin:0 0 8px;">
        ⚠ Not paid yet — this will be added to the customer's balance under "Customers Owing".
      </p>
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
      document.getElementById('dlv-credit-note').style.display = e.target.value === 'credit' ? 'block' : 'none';
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
    totalEl.textContent = money(total);
  }

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
    const methodText = method === 'credit' ? 'ON CREDIT (not paid)' : `paid by ${method.toUpperCase()}`;
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
        p_payment_method: method,
        p_staff_id: currentStaff.id,
        p_synced: true
      });
      if (error) { failed.push(`${l.label}: ${error.message}`); continue; }
      delete deliveryQty[l.row.store_product_id];
      delete deliveryPrice[l.row.store_product_id];
      ok++;
    }

    await loadLorryStock();
    await loadProfitReport();

    if (failed.length) {
      showErr(`Saved ${ok} item(s). Not saved: ${failed.join('; ')}. Fix and press Save again — saved items won't be repeated.`);
      return;
    }
    document.getElementById('dlv-name').value = '';
    document.getElementById('dlv-phone').value = '';
    document.getElementById('dlv-location').value = '';
    document.getElementById('dlv-payment').value = 'cash';
    document.getElementById('dlv-credit-note').style.display = 'none';
    renderDeliveryItems();
    alert(`✅ Delivery saved for ${name} — ${money(total)} ${method === 'credit' ? 'added to credit' : 'received'}.`);
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

    const groups = {};
    (data || []).forEach(s => {
      const key = s.customer_name || 'Unknown customer';
      if (!groups[key]) groups[key] = { name: key, phone: s.customer_phone || '', sales: [], total: 0 };
      groups[key].sales.push(s);
      groups[key].total += Number(s.quantity) * Number(s.unit_price);
      if (!groups[key].phone && s.customer_phone) groups[key].phone = s.customer_phone;
    });
    creditGroups = Object.values(groups);

    if (!creditGroups.length) {
      totalEl.textContent = '';
      listEl.innerHTML = '<div class="empty-state">No customers owing. 🎉</div>';
      return;
    }

    const grand = creditGroups.reduce((s, g) => s + g.total, 0);
    totalEl.textContent = `Total owed: ${money(grand)}`;

    listEl.innerHTML = creditGroups.map((g, i) => `
      <div style="border:1px solid var(--border, #33455c); border-radius:8px; padding:10px 12px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;">${escapeHtml(g.name)}</div>
            ${g.phone ? `<div style="color:var(--muted); font-size:0.8rem;">📞 ${escapeHtml(g.phone)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-weight:800; color:#c0392b;">${money(g.total)}</div>
            <button style="margin-top:4px;" onclick="markCreditPaid(${i})">Mark as Paid</button>
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
      </div>`).join('');
  };

  window.markCreditPaid = async function (i) {
    const g = creditGroups[i];
    if (!g) return;
    const answer = prompt(
      `${g.name}\nOwes ${money(g.total)}.\n\nHow did they pay? Type: cash, mpesa or card`, 'cash');
    if (answer === null) return;
    const method = answer.trim().toLowerCase();
    if (!['cash', 'mpesa', 'card'].includes(method)) { alert('Please type cash, mpesa or card.'); return; }
    if (!navigator.onLine) { alert('Marking as paid needs internet.'); return; }

    const ids = g.sales.map(s => s.id);
    const { error } = await supabaseClient.from('lorry_sales').update({ payment_method: method }).in('id', ids);
    if (error) { alert('Error: ' + error.message); return; }

    await loadCredit();
    await loadProfitReport();
    alert(`✅ ${g.name} marked as paid (${method}).`);
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
