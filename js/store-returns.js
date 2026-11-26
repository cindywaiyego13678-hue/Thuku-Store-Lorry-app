/* ------------------------------------------------------------------
   store-returns.js
   Adds a "Returns" card to the Store page: every return recorded from
   the lorry, newest first, with whether it went back into store stock
   (good) or was written off (damaged).

   Add ONE line to store.html, just before </body>:
     <script src="js/store-returns.js"></script>
------------------------------------------------------------------- */
(function () {
  const histCard = document.getElementById('history-table').closest('.card');
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'store-returns-card';
  card.style.marginBottom = '18px';
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <h3 style="margin:0;">↩️ Returns</h3>
      <button class="secondary" onclick="loadStoreReturns()" style="font-size:0.8rem; padding:5px 10px;">Refresh</button>
    </div>
    <p style="color:var(--muted); font-size:0.85rem; margin:0 0 8px;">Stock that came back from the lorry. Good stock is added back to store stock; damaged stock is written off.</p>
    <div id="store-returns-list" style="max-height:340px; overflow-y:auto;"><div class="empty-state">Loading...</div></div>
  `;
  histCard.parentNode.insertBefore(card, histCard.nextSibling);

  window.loadStoreReturns = async function () {
    const el = document.getElementById('store-returns-list');
    if (!navigator.onLine) { el.innerHTML = '<div class="empty-state">The returns list needs internet.</div>'; return; }
    const { data, error } = await supabaseClient
      .from('lorry_returns').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) { el.innerHTML = `<div class="empty-state">Error loading returns: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || !data.length) { el.innerHTML = '<div class="empty-state">No returns recorded yet.</div>'; return; }

    el.innerHTML = `
      <table>
        <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Status</th><th>Reason</th></tr></thead>
        <tbody>
          ${data.map(r => {
            const p = storeProducts.find(x => x.id === r.store_product_id);
            const cond = r.condition || (r.damaged ? 'damaged' : '');
            const status = cond === 'damaged' ? '<span style="color:#c0392b; font-weight:700;">Written off</span>'
              : cond === 'good' ? '<span style="color:#1a7f37; font-weight:700;">Back in store</span>' : '—';
            const when = new Date(r.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `
            <tr>
              <td style="font-size:0.82rem; white-space:nowrap;">${when}</td>
              <td>${escapeHtml(p ? displayName(p) : (r.product_name || '—'))}</td>
              <td>${r.quantity}</td>
              <td>${status}</td>
              <td style="font-size:0.82rem;">${escapeHtml(r.reason || r.notes || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  };

  // Wait for login and the product list, then load (gives up waiting after ~6s)
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    const ready = typeof currentStaff !== 'undefined' && currentStaff && typeof storeProducts !== 'undefined' && storeProducts.length;
    if (ready || tries > 20) { clearInterval(wait); loadStoreReturns(); }
  }, 300);
})();
