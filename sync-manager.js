// sync-manager.js — v1.2
const VERCEL_URL = 'https://martin-organizer.vercel.app';

const SyncManager = {

  _ultimoPush: 0,

  async push() {
    try {
      const tareas  = JSON.parse(localStorage.getItem('martin_tareas')  || '[]');
      const eventos = JSON.parse(localStorage.getItem('martin_eventos') || '[]');
      const notas   = JSON.parse(localStorage.getItem('martin_notas')   || '[]');
      const config  = {
        nombre:        localStorage.getItem('martin_nombre')        || '',
        racha:         localStorage.getItem('martin_racha')         || '1',
        ultima_visita: localStorage.getItem('martin_ultima_visita') || ''
      };

      const res = await fetch(`${VERCEL_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tareas, eventos, notas, config })
      });

      if (res.ok) {
        this._ultimoPush = Date.now();
        console.log('✅ Push OK —', tareas.length, 'tareas,', eventos.length, 'eventos');
      }
    } catch(e) {
      console.log('⚠️ Push offline');
    }
  },

  async pull() {
    try {
      if (Date.now() - this._ultimoPush < 10000) {
        console.log('⏭ Pull omitido — push reciente');
        return;
      }

      const res = await fetch(`${VERCEL_URL}/api/sync`);
      if (!res.ok) return;
      const data = await res.json();

      // TAREAS
      if (data.tareas && data.tareas.length > 0) {
        const tareas = data.tareas.map(t => ({
          id: t.id, nombre: t.nombre, ramo: t.ramo, tipo: t.tipo,
          fecha: t.fecha, urgencia: t.urgencia, hora: t.hora,
          horaFin: t.hora_fin, notas: t.notas, done: t.done
        }));
        localStorage.setItem('martin_tareas', JSON.stringify(tareas));
        console.log(`✅ Pull: ${tareas.length} tareas`);
      }

      // EVENTOS
      if (data.eventos && data.eventos.length > 0) {
        const eventos = data.eventos.map(e => ({
          id: e.id, tareaId: e.tarea_id, nombre: e.nombre, tipo: e.tipo,
          fecha: e.fecha, inicio: e.inicio, fin: e.fin, notas: e.notas,
          esEntrega: e.es_entrega, esBloquePreparacion: e.es_bloque_preparacion
        }));
        localStorage.setItem('martin_eventos', JSON.stringify(eventos));
        console.log(`✅ Pull: ${eventos.length} eventos`);
      }

      // FIX DASHBOARD: reconstruir martin_notas desde notas_ramos de Supabase
      // Supabase guarda filas planas: {ramo, val, tipo, descripcion, fecha, semestre}
      // El dashboard lee martin_notas con estructura: [{nombre, notas:[], semestre}]
      if (data.notas && data.notas.length > 0) {
        // Agrupar filas planas por nombre de ramo
        const ramosMap = {};
        data.notas.forEach(n => {
          if (!ramosMap[n.ramo]) {
            ramosMap[n.ramo] = { nombre: n.ramo, notas: [], semestre: n.semestre || 1 };
          }
          ramosMap[n.ramo].notas.push({
            val: n.val,
            tipo: n.tipo || 'napsis',
            desc: n.descripcion || '',
            fecha: n.fecha || new Date().toISOString().split('T')[0]
          });
        });

        // Fusionar con ramos locales para preservar los que no están en Supabase
        const ramosLocales = JSON.parse(localStorage.getItem('martin_notas') || '[]');
        const procesados = new Set();
        const ramosActualizados = ramosLocales.map(r => {
          if (ramosMap[r.nombre]) {
            procesados.add(r.nombre);
            return { ...r, notas: ramosMap[r.nombre].notas, semestre: ramosMap[r.nombre].semestre };
          }
          return r;
        });

        // Agregar ramos que vienen de Supabase pero no estaban en local
        Object.values(ramosMap).forEach(r => {
          if (!procesados.has(r.nombre)) ramosActualizados.push(r);
        });

        localStorage.setItem('martin_notas', JSON.stringify(ramosActualizados));
        console.log(`✅ Pull: notas reconstruidas para ${ramosActualizados.length} ramos`);
      }

      // CONFIG
      if (data.config && data.config.length > 0) {
        data.config.forEach(c => {
          if (c.clave === 'nombre'    && c.valor) localStorage.setItem('martin_nombre', c.valor);
          if (c.clave === 'racha'     && c.valor) localStorage.setItem('martin_racha', c.valor);
          if (c.clave === 'partido_u' && c.valor) localStorage.setItem('martin_partido_u', c.valor);
        });
      }
    } catch(e) {
      console.log('⚠️ Pull offline, usando datos locales');
    }
  },

  async reset() {
    try {
      localStorage.removeItem('martin_tareas');
      localStorage.removeItem('martin_eventos');
      localStorage.removeItem('martin_notas');

      await fetch(`${VERCEL_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true, tareas: [], eventos: [], notas: [], config: {} })
      });
      console.log('🧹 Reset completo');
    } catch(e) {
      console.log('⚠️ Reset solo local');
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
    try {
      const local = localStorage.getItem('martin_partido_u');
      return local ? JSON.parse(local) : null;
    } catch(e) { return null; }
  },

  // Método auxiliar para push inmediato desde calendario
  pushInmediato() {
    setTimeout(() => this.push(), 300);
  },

  async init() {
    await this.pull();
    await this.cargarPartido();
    setInterval(() => this.push(), 3 * 60 * 1000);
    window.addEventListener('beforeunload', () => this.push());
    setTimeout(() => this.push(), 5000);
  }
};
