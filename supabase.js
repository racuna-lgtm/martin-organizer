// supabase.js — cliente para usar desde los HTML
const SUPABASE_URL = 'https://cayvrsqyjljqnrtsagwq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheXZyc3F5amxqcW5ydHNhZ3dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDc3OTQsImV4cCI6MjA5MTQyMzc5NH0.aHWv_v1U1EQ52zQmfGteOR4keqmxqOKkECYR178FN3E';

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
  if (!res.ok) { const err = await res.text(); throw new Error(`Supabase ${res.status}: ${err}`); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const sb = {
  async get(tabla, params='') { return sbFetch(`${tabla}?${params}`); },
  async insert(tabla, data) { return sbFetch(tabla, { method:'POST', body:JSON.stringify(data) }); },
  async update(tabla, data, filtro) { return sbFetch(`${tabla}?${filtro}`, { method:'PATCH', body:JSON.stringify(data) }); },
  async delete(tabla, filtro) { return sbFetch(`${tabla}?${filtro}`, { method:'DELETE', prefer:'return=minimal' }); },
  async upsert(tabla, data) { return sbFetch(tabla, { method:'POST', body:JSON.stringify(data), headers:{'Prefer':'resolution=merge-duplicates,return=representation'} }); }
};
