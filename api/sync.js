// api/sync.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = 'https://cayvrsqyjljqnrtsagwq.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheXZyc3F5amxqcW5ydHNhZ3dxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg0Nzc5NCwiZXhwIjoyMDkxNDIzNzk0fQ.m4hZ4VZXvHOGefATU892T092eWEDxQzEDynozA-xhFg';

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=representation'
  };

  const sbGet = async (tabla) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?order=created_at.desc`, { headers });
    return r.json();
  };

  const sbPost = async (tabla, data, prefer='resolution=merge-duplicates,return=representation') => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': prefer },
      body: JSON.stringify(data)
    });
    return r.json();
  };

  try {
    if (req.method === 'GET') {
      const [tareas, eventos, notas, config] = await Promise.all([
        sbGet('tareas'),
        sbGet('eventos'),
        sbGet('notas_ramos'),
        sbGet('config')
      ]);
      return res.status(200).json({ tareas, eventos, notas, config });
    }

    if (req.method === 'POST') {
      const { tareas, eventos, notas, config } = req.body;

      if (tareas && tareas.length > 0) {
        await sbPost('tareas', tareas.map(t => ({
          id: t.id, nombre: t.nombre, ramo: t.ramo || '',
          tipo: t.tipo || 'tarea', fecha: t.fecha || null,
          urgencia: t.urgencia || 'normal', hora: t.hora || null,
          hora_fin: t.horaFin || null, notas: t.notas || '', done: t.done || false
        })));
      }

      if (eventos && eventos.length > 0) {
        await sbPost('eventos', eventos.map(e => ({
          id: String(e.id), tarea_id: e.tareaId ? Number(e.tareaId) : null,
          nombre: e.nombre, tipo: e.tipo || 'estudio',
          fecha: e.fecha || null, inicio: e.inicio || null, fin: e.fin || null,
          notas: e.notas || '', es_entrega: e.esEntrega || false,
          es_bloque_preparacion: e.esBloquePreparacion || false
        })));
      }

      if (notas && notas.length > 0) {
        const notasFlat = [];
        notas.forEach(ramo => {
          (ramo.notas || []).forEach(n => {
            notasFlat.push({
              ramo: ramo.nombre, val: n.val, tipo: n.tipo || '',
              descripcion: n.desc || '', fecha: n.fecha || null, semestre: ramo.semestre || 1
            });
          });
        });
        if (notasFlat.length > 0) await sbPost('notas_ramos', notasFlat, 'return=minimal');
      }

      if (config) {
        const configArr = Object.entries(config).map(([clave, valor]) => ({ clave, valor: String(valor) }));
        await sbPost('config', configArr);
      }

      return res.status(200).json({ ok: true });
    }
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
}
