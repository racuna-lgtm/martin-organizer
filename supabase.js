// ── SUPABASE CLIENT ──
// Este archivo se incluye en cada HTML que necesita la base de datos

const SUPABASE_URL = 'https://cayvrsqyjljqnrtsagwq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JLaCYGFE3fq6b7ecDl0glA_axBuVRZo';

async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ── API HELPERS ──
const sb = {
  // Leer todos los registros de una tabla
  async get(tabla, params = '') {
    return sbFetch(`${tabla}?${params}`);
  },

  // Insertar un registro
  async insert(tabla, data) {
    return sbFetch(tabla, {
      method: 'POST',
      body: JSON.stringify(data),
      prefer: 'return=representation'
    });
  },

  // Actualizar registros
  async update(tabla, data, filtro) {
    return sbFetch(`${tabla}?${filtro}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      prefer: 'return=representation'
    });
  },

  // Eliminar registros
  async delete(tabla, filtro) {
    return sbFetch(`${tabla}?${filtro}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    });
  },

  // Upsert (insert o update)
  async upsert(tabla, data) {
    return sbFetch(tabla, {
      method: 'POST',
      body: JSON.stringify(data),
      prefer: 'return=representation',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' }
    });
  }
};
