// sync-manager.js
const VERCEL_URL = 'https://martin-organizer.vercel.app';

const SyncManager = {

  // Timestamp del último push exitoso (para no hacer pull encima de cambios locales)
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
        // Siempre mandamos tareas y eventos aunque estén vacíos
        // para que el servidor pueda eliminar lo que ya no existe
        body: JSON.stringify({ tareas, eventos, notas, config })
      });

      if (res.ok) {
        this._ultimoPush = Date.now();
        console.log('✅ Sync push OK —', tareas.length, 'tareas,', eventos.length, 'eventos');
      }
    } catch(e) {
      console.log('⚠️ Push offline, datos guardados localmente');
    }
  },

  async pull() {
    try {
      // Si hicimos push hace menos de 10 segundos, no hacer pull
      // (evita que Supabase sobreescriba cambios locales recién guardados)
      if (Date.now() - this._ultimoPush < 10000) {
        console.log('⏭ Pull omitido — push reciente');
        return;
      }

      const res = await fetch(`${VERCEL_URL}/api/sync`);
      if (!res.ok) return;
      const data = await res.json();

      // TAREAS: solo actualizar si Supabase tiene más datos que localStorage
      if (data.tareas && data.tareas.length > 0) {
        const locales = JSON.parse(localStorage.getItem('martin_tareas') || '[]');
        // Supabase manda como fuente de verdad si tiene datos
        const tareas = data.tareas.map(t => ({
          id: t.id, nombre: t.nombre, ramo: t.ramo, tipo: t.tipo,
          fecha: t.fecha, urgencia: t.urgencia, hora: t.hora,
          horaFin: t.hora_fin, notas: t.notas, done: t.done
        }));
        localStorage.setItem('martin_tareas', JSON.stringify(tareas));
        console.log(`✅ Pull: ${tareas.length} tareas desde Supabase`);
      }

      // EVENTOS
      if (data.eventos && data.eventos.length > 0) {
        const eventos = data.eventos.map(e => ({
          id: e.id, tareaId: e.tarea_id, nombre: e.nombre, tipo: e.tipo,
          fecha: e.fecha, inicio: e.inicio, fin: e.fin, notas: e.notas,
          esEntrega: e.es_entrega, esBloquePreparacion: e.es_bloque_preparacion
        }));
        localStorage.setItem('martin_eventos', JSON.stringify(eventos));
        console.log(`✅ Pull: ${eventos.length} eventos desde Supabase`);
      }

      // CONFIG
      if (data.config && data.config.length > 0) {
        data.config.forEach(c => {
          if (c.clave === 'nombre' && c.valor) localStorage.setItem('martin_nombre', c.valor);
          if (c.clave === 'racha'  && c.valor) localStorage.setItem('martin_racha', c.valor);
          if (c.clave === 'partido_u' && c.valor) localStorage.setItem('martin_partido_u', c.valor);
        });
      }
    } catch(e) {
      console.log('⚠️ Pull offline, usando datos locales');
    }
  },

  // Reset completo: limpia localStorage Y Supabase
  async reset() {
    try {
      // 1. Limpiar localStorage
      localStorage.removeItem('martin_tareas');
      localStorage.removeItem('martin_eventos');
      localStorage.removeItem('martin_notas');

      // 2. Decirle al servidor que limpie Supabase también
      await fetch(`${VERCEL_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true, tareas: [], eventos: [], notas: [], config: {} })
      });

      console.log('🧹 Reset completo — localStorage y Supabase limpiados');
    } catch(e) {
      console.log('⚠️ Reset solo local (offline)');
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

  async init() {
    // 1. Pull desde Supabase
    await this.pull();
    // 2. Cargar partido de la U
    await this.cargarPartido();
    // 3. Push cada 3 minutos
    setInterval(() => this.push(), 3 * 60 * 1000);
    // 4. Push al cerrar pestaña
    window.addEventListener('beforeunload', () => this.push());
    // 5. Push inicial después de 5 segundos
    setTimeout(() => this.push(), 5000);
  }
};
