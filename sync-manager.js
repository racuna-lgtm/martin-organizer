// sync-manager.js
// Incluir en todos los HTML después de supabase.js
// Sincroniza automáticamente localStorage ↔ Supabase

const VERCEL_URL = 'https://martin-organizer.vercel.app';

const SyncManager = {
  // Última sincronización
  ultimaSync: localStorage.getItem('martin_ultima_sync') || null,

  // Subir datos locales a Supabase
  async push() {
    try {
      const payload = {
        tareas: JSON.parse(localStorage.getItem('martin_tareas') || '[]'),
        eventos: JSON.parse(localStorage.getItem('martin_eventos') || '[]'),
        notas: JSON.parse(localStorage.getItem('martin_notas') || '[]'),
        config: {
          nombre: localStorage.getItem('martin_nombre') || '',
          racha: localStorage.getItem('martin_racha') || '1',
          ultima_visita: localStorage.getItem('martin_ultima_visita') || ''
        }
      };

      const res = await fetch(`${VERCEL_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        localStorage.setItem('martin_ultima_sync', new Date().toISOString());
        this.ultimaSync = new Date().toISOString();
        console.log('✅ Sync OK →', new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.log('⚠️ Sin conexión, datos guardados localmente');
    }
  },

  // Bajar datos desde Supabase al localStorage
  async pull() {
    try {
      const res = await fetch(`${VERCEL_URL}/api/sync`);
      if (!res.ok) return;
      const data = await res.json();

      // Solo actualizar si hay datos en el servidor
      if (data.tareas && data.tareas.length > 0) {
        // Convertir formato Supabase → localStorage
        const tareas = data.tareas.map(t => ({
          id: t.id,
          nombre: t.nombre,
          ramo: t.ramo,
          tipo: t.tipo,
          fecha: t.fecha,
          urgencia: t.urgencia,
          hora: t.hora,
          horaFin: t.hora_fin,
          notas: t.notas,
          done: t.done
        }));
        localStorage.setItem('martin_tareas', JSON.stringify(tareas));
      }

      if (data.eventos && data.eventos.length > 0) {
        const eventos = data.eventos.map(e => ({
          id: e.id,
          tareaId: e.tarea_id,
          nombre: e.nombre,
          tipo: e.tipo,
          fecha: e.fecha,
          inicio: e.inicio,
          fin: e.fin,
          notas: e.notas,
          esEntrega: e.es_entrega,
          esBloquePreparacion: e.es_bloque_preparacion
        }));
        localStorage.setItem('martin_eventos', JSON.stringify(eventos));
      }

      // Config
      if (data.config && data.config.length > 0) {
        data.config.forEach(c => {
          if (c.clave === 'nombre') localStorage.setItem('martin_nombre', c.valor);
          if (c.clave === 'racha') localStorage.setItem('martin_racha', c.valor);
          if (c.clave === 'partido_u') localStorage.setItem('martin_partido_u', c.valor);
        });
      }

      console.log('✅ Pull OK desde Supabase');
    } catch (e) {
      console.log('⚠️ Sin conexión, usando datos locales');
    }
  },

  // Obtener partido de la U
  async cargarPartido() {
    try {
      const res = await fetch(`${VERCEL_URL}/api/partido-u`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.partido) {
        localStorage.setItem('martin_partido_u', JSON.stringify(data.partido));
        return data.partido;
      }
      return null;
    } catch (e) {
      // Usar el partido guardado localmente como fallback
      const local = localStorage.getItem('martin_partido_u');
      return local ? JSON.parse(local) : null;
    }
  },

  // Inicializar — pull al cargar, push cada 2 minutos
  async init() {
    await this.pull();
    await this.cargarPartido();
    // Auto-sync cada 2 minutos si la app está abierta
    setInterval(() => this.push(), 2 * 60 * 1000);
    // Push cuando cierra la pestaña
    window.addEventListener('beforeunload', () => this.push());
  }
};
