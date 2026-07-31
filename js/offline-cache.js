// ============================================================
// Simple local cache for "last known" data (products, staff list)
// so pages can still show something useful when there's no
// internet at all — not just for queuing new sales.
// Uses localStorage since this data is small (a shop's catalog).
// ============================================================
const CACHE_PREFIX = 'thuku_store_cache_';

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data, cachedAt: new Date().toISOString()
    }));
  } catch (e) {
    console.warn('Cache write failed', e);
  }
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Shows a small "offline — showing last saved data" banner at the
// top of the page. Call showOfflineBanner(cachedAt) when falling
// back to cached data instead of live data.
function showOfflineBanner(cachedAt) {
  let banner = document.getElementById('offline-data-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-data-banner';
    banner.style.cssText = 'background:#c99a3d; color:#2a1f08; padding:8px 16px; text-align:center; font-size:0.85rem; font-weight:600;';
    document.body.insertBefore(banner, document.body.firstChild);
  }
  const when = cachedAt ? new Date(cachedAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'earlier';
  banner.textContent = `📡 Offline — showing data last saved ${when}. New changes will sync once you're back online.`;
}

function hideOfflineBanner() {
  const banner = document.getElementById('offline-data-banner');
  if (banner) banner.remove();
}
