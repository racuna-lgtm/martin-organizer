// sync-manager.js
const VERCEL_URL = 'https://martin-organizer.vercel.app';

const SyncManager = {

  async push() {
    try {
      const payload = {
        tareas:  JSON.parse(localStorage.getItem('martin_tareas')  || '[]'),
        eventos: JSON.parse(localStorage.getItem('martin_eventos') || '[]'),
        notas:   JSON.parse(localStorage.getItem('martin_notas')   || '[]'),
        config: {
          nombre:        localStorage.getItem('martin_nombre')        || '',
          racha:         localStorage.getItem('martin_racha')         || '1',
          ultima_visita: localStorage.getItem('martin_ultima_visita') || ''
        }
      };
      // Solo hacer push si hay datos reales
      if (!payload.tareas.length && !payload.notas.length) return;

      const res = await fetch(`${VERCEL_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) console.log('✅ Sync push OK');
    } catch(e) {
      console.log('⚠️ Push offline, datos guardados localmente');
    }
  },

  async pull() {
    try {
      const res = await fetch(`${VERCEL_URL}/api/sync`);
      if (!res.ok) return;
      const data = await res.json();

      // Solo actualizar localStorage si Supabase tiene datos
      // (no sobreescribir datos locales con tablas vacías)
      if (data.tareas && data.tareas.length > 0) {
        const tareas = data.tareas.map(t => ({
          id: t.id, nombre: t.nombre, ramo: t.ramo, tipo: t.tipo,
          fecha: t.fecha, urgencia: t.urgencia, hora: t.hora,
          horaFin: t.hora_fin, notas: t.notas, done: t.done
        }));
        localStorage.setItem('martin_tareas', JSON.stringify(tareas));
        console.log(`✅ Pull: ${tareas.length} tareas desde Supabase`);
      }

      if (data.eventos && data.eventos.length > 0) {
        const eventos = data.eventos.map(e => ({
          id: e.id, tareaId: e.tarea_id, nombre: e.nombre, tipo: e.tipo,
          fecha: e.fecha, inicio: e.inicio, fin: e.fin, notas: e.notas,
          esEntrega: e.es_entrega, esBloquePreparacion: e.es_bloque_preparacion
        }));
        localStorage.setItem('martin_eventos', JSON.stringify(eventos));
      }

      // Config (nombre, racha, partido)
      if (data.config && data.config.length > 0) {
        data.config.forEach(c => {
          if (c.clave === 'nombre' && c.valor)
            localStorage.setItem('martin_nombre', c.valor);
          if (c.clave === 'racha' && c.valor)
            localStorage.setItem('martin_racha', c.valor);
          if (c.clave === 'partido_u' && c.valor)
            localStorage.setItem('martin_partido_u', c.valor);
        });
      }
    } catch(e) {
      console.log('⚠️ Pull offline, usando datos locales');
    }
  },

  async cargarPartido() {
    try {
      const res = await fetch(`${VERCEL_URL}/api/partido-u`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.partido) {
        localStorage.setItem('martin_partido_u', JSON.stringify(data.partido));
        return data.partido;
      }
    } catch(e) {}
    // Fallback al partido guardado localmente
    try {
      const local = localStorage.getItem('martin_partido_u');
      return local ? JSON.parse(local) : null;
    } catch(e) { return null; }
  },

  async init() {
    // 1. Pull desde Supabase (no sobreescribe si está vacío)
    await this.pull();
    // 2. Cargar partido de la U
    await this.cargarPartido();
    // 3. Push local → Supabase cada 3 minutos
    setInterval(() => this.push(), 3 * 60 * 1000);
    // 4. Push al cerrar pestaña
    window.addEventListener('beforeunload', () => this.push());
    // 5. Push inicial después de 5 segundos (dar tiempo al render)
    setTimeout(() => this.push(), 5000);
  }
};
