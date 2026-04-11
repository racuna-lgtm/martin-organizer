// api/sync.js
// Sincroniza tareas, eventos y notas entre el cliente y Supabase
// POST /api/sync — recibe datos del cliente y los guarda
// GET /api/sync — devuelve todos los datos del usuario

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=representation'
  };

  try {
    if (req.method === 'POST') {
      // Cliente envía sus datos → guardar en Supabase
      const { tareas, eventos, notas, config } = req.body;

      // Sincronizar tareas
      if (tareas && tareas.length > 0) {
        const tareasFormato = tareas.map(t => ({
          id: t.id,
          nombre: t.nombre,
          ramo: t.ramo || '',
          tipo: t.tipo || 'tarea',
          fecha: t.fecha || null,
          urgencia: t.urgencia || 'normal',
          hora: t.hora || null,
          hora_fin: t.horaFin || null,
          notas: t.notas || '',
          done: t.done || false
        }));
        await fetch(`${supabaseUrl}/rest/v1/tareas`, {
          method: 'POST',
          headers,
          body: JSON.stringify(tareasFormato)
        });
      }

      // Sincronizar eventos
      if (eventos && eventos.length > 0) {
        const eventosFormato = eventos.map(e => ({
          id: String(e.id),
          tarea_id: e.tareaId ? Number(e.tareaId) : null,
          nombre: e.nombre,
          tipo: e.tipo || 'estudio',
          fecha: e.fecha || null,
          inicio: e.inicio || null,
          fin: e.fin || null,
          notas: e.notas || '',
          es_entrega: e.esEntrega || false,
          es_bloque_preparacion: e.esBloquePreparacion || false
        }));
        await fetch(`${supabaseUrl}/rest/v1/eventos`, {
          method: 'POST',
          headers,
          body: JSON.stringify(eventosFormato)
        });
      }

      // Sincronizar notas de ramos
      if (notas && notas.length > 0) {
        // Primero borrar las notas existentes y reinsertarlas
        await fetch(`${supabaseUrl}/rest/v1/notas_ramos?id=gte.0`, {
          method: 'DELETE',
          headers
        });
        const notasFormato = [];
        notas.forEach(ramo => {
          ramo.notas.forEach(n => {
            notasFormato.push({
              ramo: ramo.nombre,
              val: n.val,
              tipo: n.tipo || '',
              descripcion: n.desc || '',
              fecha: n.fecha || null,
              semestre: ramo.semestre || 1
            });
          });
        });
        if (notasFormato.length > 0) {
          await fetch(`${supabaseUrl}/rest/v1/notas_ramos`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify(notasFormato)
          });
        }
      }

      // Guardar config (nombre, PIN hash, racha)
      if (config) {
        for (const [clave, valor] of Object.entries(config)) {
          await fetch(`${supabaseUrl}/rest/v1/config`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ clave, valor: String(valor) })
          });
        }
      }

      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      // Devolver todos los datos al cliente
      const [tareas, eventos, notas, config] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/tareas?order=created_at.desc`, { headers }).then(r => r.json()),
        fetch(`${supabaseUrl}/rest/v1/eventos?order=fecha.asc`, { headers }).then(r => r.json()),
        fetch(`${supabaseUrl}/rest/v1/notas_ramos?order=ramo.asc`, { headers }).then(r => r.json()),
        fetch(`${supabaseUrl}/rest/v1/config`, { headers }).then(r => r.json())
      ]);

      return res.status(200).json({ tareas, eventos, notas, config });
    }

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
}
