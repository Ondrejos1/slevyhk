const SUPABASE_URL = 'https://pmnklxbdhgzsmqfekjqe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtbmtseGJkaGd6c21xZmVranFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNTIwNTksImV4cCI6MjA3NzgyODA1OX0.DfZ-d-rMjjIzk-nWi0djtIBf6afveIEWLg-pBrgogsE';

// Inicializace (CDN UMD export je `supabase.createClient`)
const supabase = (typeof supabase !== 'undefined' && supabase.createClient)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!supabase) console.error('Supabase client not found. Přidej CDN script pro @supabase/supabase-js nebo uprav import.');

// Markery: id -> leaflet marker
const markers = new Map();

async function loadDiscounts() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('discounts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Chyba při načítání slev:', error);
    return;
  }

  data.forEach(addOrUpdateMarker);
}

function addOrUpdateMarker(d) {
  if (!d || !d.latitude || !d.longitude) return;
  const id = d.id;
  const html = `
    <strong>${escapeHtml(d.title)}</strong><br/>
    <em>${escapeHtml(d.category || '')}</em><br/>
    ${escapeHtml(d.description || '')}<br/>
    <small>${escapeHtml(d.discount_value || '')}</small>
  `;

  if (markers.has(id)) {
    const marker = markers.get(id);
    marker.setLatLng([d.latitude, d.longitude]);
    marker.setPopupContent(html);
  } else {
    const marker = L.marker([d.latitude, d.longitude]).addTo(map).bindPopup(html);
    markers.set(id, marker);
  }
}

function removeMarker(id) {
  const m = markers.get(id);
  if (m) {
    map.removeLayer(m);
    markers.delete(id);
  }
}

// Realtime subscription (podporuji jak v2 channel(), tak starší from().on())
function subscribeRealtime() {
  if (!supabase) return;

  // supabase-js v2 (channel)
  if (typeof supabase.channel === 'function') {
    supabase
      .channel('public:discounts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'discounts' },
        (payload) => {
          const ev = payload.eventType;
          const record = payload.new || payload.old;
          if (ev === 'INSERT') addOrUpdateMarker(record);
          if (ev === 'UPDATE') addOrUpdateMarker(record);
          if (ev === 'DELETE') removeMarker(record.id);
        }
      )
      .subscribe();
    return;
  }

  // starší supabase-js API
  if (typeof supabase.from === 'function') {
    supabase
      .from('discounts')
      .on('*', payload => {
        const ev = payload.eventType;
        if (ev === 'INSERT') addOrUpdateMarker(payload.new);
        if (ev === 'UPDATE') addOrUpdateMarker(payload.new);
        if (ev === 'DELETE') removeMarker(payload.old.id);
      })
      .subscribe();
  }
}

// CRUD: vytvoření nové slevy (autentizovaný uživatel)
async function createDiscount(discount) {
  // discount = { title, description, category, latitude, longitude, discount_value }
  if (!supabase) throw new Error('Supabase client není inicializován');

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    throw new Error('Uživatel není přihlášen');
  }
  const owner = userData.user.id;

  const { data, error } = await supabase
    .from('discounts')
    .insert([{ ...discount, owner }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Jednoduché přihlášení / registrace
async function signUp(email, password) {
  if (!supabase) throw new Error('Supabase client není inicializován');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase client není inicializován');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  if (!supabase) throw new Error('Supabase client není inicializován');
  await supabase.auth.signOut();
}

// Utility (XSS ochrana)
function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Spuštění: načti data a přihlaš se na realtime
// Zavolej tyto funkce až poté, co máš inicializovanou mapu (map)
if (typeof map !== 'undefined') {
  loadDiscounts();
  subscribeRealtime();
} else {
  // Pokud map není dostupná okamžitě, vyvolej loadDiscounts/subscribeRealtime po inicializaci mapy
  console.info('Leaflet map není zatím inicializovaná. Zavolej loadDiscounts() a subscribeRealtime() po inicializaci.');
}
