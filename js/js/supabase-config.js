// ============================================================
// Supabase configuration — SAME project as the Thuku Enterprise
// shop app. This is what makes store→shop transfers visible in
// both apps.
// ============================================================
const SUPABASE_URL = 'https://ipbqeyeanlyvklrjcbxl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwYnFleWVhbmx5dmtscmpjYnhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NjAzOTYsImV4cCI6MjA5ODQzNjM5Nn0.tzqpOhol3sbrxMlpHFemK7cDbiW8NNeColEARHPmK5E';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });
}

// ---------- Auth helpers (offline-resilient) ----------
async function getCurrentStaff() {
  const { data: { user } } = await supabaseClient.auth.getUser().catch(() => ({ data: { user: null } }));
  const { data: { session } } = await supabaseClient.auth.getSession();
  const effectiveUser = user || session?.user;
  if (!effectiveUser) return null;

  if (navigator.onLine) {
    const { data, error } = await supabaseClient
      .from('staff')
      .select('*')
      .eq('id', effectiveUser.id)
      .single();
    if (!error && data) {
      cacheSet('staff_profile_' + effectiveUser.id, data);
      return data;
    }
  }

  const cached = cacheGet('staff_profile_' + effectiveUser.id);
  if (cached) return cached.data;
  return null;
}

async function requireAuth(allowedRoles = null) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  const staff = await getCurrentStaff();
  if (!staff || !staff.is_active) {
    if (navigator.onLine) await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    alert('You do not have access to this page.');
    window.location.href = 'store.html';
    return null;
  }
  return staff;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}
