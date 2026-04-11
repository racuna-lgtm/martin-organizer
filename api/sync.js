// api/sync.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = 'https://cayvrsqyjljqnrtsagwq.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheXZyc3F5amxqcW5ydHNhZ3dxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg0Nzc5NCwiZXhwIjoyMDkxNDIzNzk0fQ.m4hZ4VZXvHOGefATU892T092eWEDxQzEDynozA-xhFg';

  const h = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  const sbGet = async (tabla) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?order=created_at.desc`, { headers: h });
    return r.ok ? r.json() : [];
  };

  const sbUpsert = async (tabla, data) => {
    if (!data?.length) return;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
      method: 'POST',
      headers: { ...h, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(data)
    });
    return r;
  };

  // DELETE real: elimina IDs que ya no existen en el cliente
  const sbDeleteMissing = async (tabla, idCol, idsActuales) => {
    if (!idsActuales) return;
    // Traer todos los IDs que están en Supabase
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=${idCol}`, { headers: h });
    if (!r.ok) return;
    const rows = await r.json();
    const idsEnDB = rows.map(x => String(x[idCol]));
    const idsCliente = idsActuales.map(x => String(x));
    const paraEliminar = idsEnDB.filter(id => !idsCliente.includes(id));
    if (!paraEliminar.length) return;
    // Eliminar de a uno o en batch con IN
    const inList = paraEliminar.map(id => `"${id}"`).join(',');
    await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${idCol}=in.(${inList})`, {
      method: 'DELETE',
      headers: { ...h, 'Prefer': 'return=minimal' }
    });
    console.log(`🗑 Eliminados de ${tabla}:`, paraEliminar);
  };

  try {
    // ── GET: traer todo desde Supabase ──
    if (req.method === 'GET') {
      const [tareas, eventos, notas, config] = await Promise.all([
        sbGet('tareas'),
        sbGet('eventos'),
        sbGet('notas_ramos'),
        sbGet('config')
      ]);
      return res.status(200).json({ tareas, eventos, notas, config });
    }

    // ── POST: push completo con DELETE de lo que ya no existe ──
    if (req.method === 'POST') {
      const { tareas, eventos, notas, config, reset } = req.body;

      // Si viene flag reset=true, limpiar todo primero
      if (reset) {
        await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/tareas?id=gte.0`, { method: 'DELETE', headers: { ...h, 'Prefer': 'return=minimal' } }),
          fetch(`${SUPABASE_URL}/rest/v1/eventos?id=gte.0`, { method: 'DELETE', headers: { ...h, 'Prefer': 'return=minimal' } }),
          fetch(`${SUPABASE_URL}/rest/v1/notas_ramos?id=gte.0`, { method: 'DELETE', headers: { ...h, 'Prefer': 'return=minimal' } }),
        ]);
        return res.status(200).json({ ok: true, reset: true });
      }

      // TAREAS: upsert las actuales + eliminar las que ya no están
      if (tareas !== undefined) {
        const tareasDB = (tareas || []).map(t => ({
          id: t.id, nombre: t.nombre, ramo: t.ramo || '',
          tipo: t.tipo || 'tarea', fecha: t.fecha || null,
          urgencia: t.urgencia || 'normal', hora: t.hora || null,
          hora_fin: t.horaFin || null, notas: t.notas || '',
          done: t.done || false
        }));
        if (tareasDB.length > 0) await sbUpsert('tareas', tareasDB);
        // Eliminar tareas que ya no existen en cliente
        await sbDeleteMissing('tareas', 'id', tareas.map(t => t.id));
      }

      // EVENTOS: upsert los actuales + eliminar los que ya no están
      if (eventos !== undefined) {
        const eventosDB = (eventos || []).map(e => ({
          id: String(e.id),
          tarea_id: e.tareaId ? Number(e.tareaId) : null,
          nombre: e.nombre, tipo: e.tipo || 'estudio',
          fecha: e.fecha || null, inicio: e.inicio || null,
          fin: e.fin || null, notas: e.notas || '',
          es_entrega: e.esEntrega || false,
          es_bloque_preparacion: e.esBloquePreparacion || false
        }));
        if (eventosDB.length > 0) await sbUpsert('eventos', eventosDB);
        // Eliminar eventos que ya no existen en cliente
        await sbDeleteMissing('eventos', 'id', eventos.map(e => String(e.id)));
      }

      // NOTAS: reemplazar completo (son datos de Napsis, no tienen IDs fijos)
      if (notas !== undefined && notas.length > 0) {
        const notasFlat = [];
        notas.forEach(ramo => {
          (ramo.notas || []).forEach(n => {
            notasFlat.push({
              ramo: ramo.nombre, val: n.val, tipo: n.tipo || '',
              descripcion: n.desc || '', fecha: n.fecha || null,
              semestre: ramo.semestre || 1
            });
          });
        });
        if (notasFlat.length > 0) await sbUpsert('notas_ramos', notasFlat);
      }

      // CONFIG
      if (config) {
        const configArr = Object.entries(config)
          .filter(([, v]) => v !== '' && v !== null && v !== undefined)
          .map(([clave, valor]) => ({ clave, valor: String(valor) }));
        if (configArr.length) await sbUpsert('config', configArr);
      }

      return res.status(200).json({ ok: true });
    }

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
}
