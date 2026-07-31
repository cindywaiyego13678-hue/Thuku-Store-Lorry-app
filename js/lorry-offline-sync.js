// ============================================================
// Offline-first sync for lorry sales: queues in IndexedDB when
// offline, pushes to Supabase (via the record_lorry_sale RPC,
// so stock still gets decremented correctly) once back online.
// ============================================================
const LORRY_DB_NAME = 'thuku_lorry_db';
const LORRY_DB_VERSION = 1;
const LORRY_STORE_NAME = 'pending_lorry_sales';

function openLorryDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LORRY_DB_NAME, LORRY_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(LORRY_STORE_NAME)) {
        db.createObjectStore(LORRY_STORE_NAME, { keyPath: 'localId', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function queueLorrySaleOffline(saleData) {
  const db = await openLorryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LORRY_STORE_NAME, 'readwrite');
    tx.objectStore(LORRY_STORE_NAME).add({ ...saleData, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getPendingLorrySales() {
  const db = await openLorryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LORRY_STORE_NAME, 'readonly');
    const req = tx.objectStore(LORRY_STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function removePendingLorrySale(localId) {
  const db = await openLorryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LORRY_STORE_NAME, 'readwrite');
    tx.objectStore(LORRY_STORE_NAME).delete(localId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function syncPendingLorrySales() {
  if (!navigator.onLine) return;
  const pending = await getPendingLorrySales();
  if (!pending.length) return;

  for (const sale of pending) {
    try {
      const { error } = await supabaseClient.rpc('record_lorry_sale', {
        p_store_product_id: sale.store_product_id,
        p_quantity: sale.quantity,
        p_unit_price: sale.unit_price,
        p_customer_name: sale.customer_name,
        p_customer_phone: sale.customer_phone,
        p_payment_method: sale.payment_method,
        p_staff_id: sale.staff_id,
        p_synced: false
      });
      if (error) throw error;
      await removePendingLorrySale(sale.localId);
      console.log('Synced offline lorry sale', sale.localId);
    } catch (err) {
      console.error('Failed to sync lorry sale, will retry later', err);
      break;
    }
  }

  const remaining = await getPendingLorrySales();
  updateLorrySyncBadge(remaining.length);
  if (typeof loadLorryStock === 'function') loadLorryStock();
}

function updateLorrySyncBadge(count) {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = `${count} sale${count > 1 ? 's' : ''} waiting to sync`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

window.addEventListener('online', syncPendingLorrySales);
document.addEventListener('DOMContentLoaded', async () => {
  const pending = await getPendingLorrySales();
  updateLorrySyncBadge(pending.length);
  syncPendingLorrySales();
});
