// api/napsis.js
// Scraping de notas desde Napsis Portal Padres
// Máximo 2 llamadas al día — no abusar del sistema

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const NAPSIS_USER = process.env.NAPSIS_USER;
    const NAPSIS_PASS = process.env.NAPSIS_PASS;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

    if (!NAPSIS_USER || !NAPSIS_PASS) {
      return res.status(200).json({ notas: null, error: 'Credenciales no configuradas' });
    }

    // Verificar cuándo fue la última consulta (máximo 2 veces al día)
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/config?clave=eq.napsis_ultima_consulta`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const configData = await configRes.json();
    if (configData && configData.length > 0) {
      const ultima = new Date(configData[0].valor);
      const ahora = new Date();
      const horasDesdeUltima = (ahora - ultima) / (1000 * 60 * 60);
      if (horasDesdeUltima < 12) {
        return res.status(200).json({
          notas: null,
          mensaje: `Última consulta hace ${Math.round(horasDesdeUltima)} horas. Próxima disponible en ${Math.round(12 - horasDesdeUltima)} horas.`
        });
      }
    }

    // PASO 1: Login en Napsis
    const loginRes = await fetch('https://login.napsis.com/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Referer': 'https://login.napsis.com/'
      },
      body: new URLSearchParams({
        'email': NAPSIS_USER,
        'password': NAPSIS_PASS
      }),
      redirect: 'manual'
    });

    // Capturar cookies de sesión
    const cookies = loginRes.headers.get('set-cookie') || '';
    if (!cookies) {
      return res.status(200).json({ notas: null, error: 'Login fallido — sin cookies de sesión' });
    }

    // PASO 2: Seleccionar rol Padres y Apoderados
    const rolRes = await fetch('https://login.napsis.com/selector-roles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://login.napsis.com/'
      },
      body: new URLSearchParams({ 'sistema': '3' }), // 3 = Padres y Apoderados
      redirect: 'manual'
    });

    const cookiesRol = rolRes.headers.get('set-cookie') || cookies;
    const redirectUrl = rolRes.headers.get('location') || '';

    // PASO 3: Acceder a las notas de Martín
    // URL con los IDs hardcodeados desde la imagen
    const NOTAS_URL = 'https://padres-apoderados.napsis.cl/notas/22779097-0/3/2006/36026279/26503';

    const notasRes = await fetch(NOTAS_URL, {
      headers: {
        'Cookie': cookiesRol,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://padres-apoderados.napsis.cl/'
      }
    });

    if (!notasRes.ok) {
      return res.status(200).json({ notas: null, error: `Error al acceder notas: ${notasRes.status}` });
    }

    const html = await notasRes.text();

    // PASO 4: Parsear la tabla de notas del HTML
    const notas = parsearNotasNapsis(html);

    if (!notas || notas.length === 0) {
      return res.status(200).json({ notas: null, error: 'No se pudieron parsear las notas' });
    }

    // PASO 5: Guardar en Supabase
    // Primero limpiar notas anteriores
    await fetch(`${SUPABASE_URL}/rest/v1/notas_ramos?id=gte.0`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });

    // Insertar notas nuevas
    const notasFlat = [];
    notas.forEach(ramo => {
      ramo.notas.forEach(n => {
        notasFlat.push({
          ramo: ramo.nombre,
          val: n.val,
          tipo: n.tipo,
          descripcion: n.desc,
          fecha: new Date().toISOString().split('T')[0],
          semestre: 1
        });
      });
    });

    if (notasFlat.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/notas_ramos`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(notasFlat)
      });
    }

    // Guardar timestamp de última consulta
    await fetch(`${SUPABASE_URL}/rest/v1/config`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        clave: 'napsis_ultima_consulta',
        valor: new Date().toISOString()
      })
    });

    return res.status(200).json({
      notas,
      total: notasFlat.length,
      mensaje: `${notas.length} ramos actualizados desde Napsis`
    });

  } catch (error) {
    console.error('Error Napsis:', error);
    return res.status(200).json({ notas: null, error: error.message });
  }
}

function parsearNotasNapsis(html) {
  // Parsear la tabla de notas del HTML de Napsis
  // La tabla tiene estructura: Asignatura | PP1 | PF
  const notas = [];

  // Buscar filas de la tabla de notas
  const filaRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const celdaRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const limpiar = str => str.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

  const filas = [...html.matchAll(filaRegex)];

  for (const fila of filas) {
    const celdas = [...fila[1].matchAll(celdaRegex)].map(m => limpiar(m[1]));
    if (celdas.length < 2) continue;

    const nombreRamo = celdas[0];
    if (!nombreRamo || nombreRamo.length < 3) continue;
    // Filtrar filas de encabezado
    if (nombreRamo === 'Asignatura' || nombreRamo === 'Ramo') continue;

    const ramNotas = [];
    // Buscar notas numéricas en las celdas (formato X.X)
    for (let i = 1; i < celdas.length; i++) {
      const val = parseFloat(celdas[i].replace(',', '.'));
      if (!isNaN(val) && val >= 1.0 && val <= 7.0) {
        ramNotas.push({
          val,
          tipo: i === celdas.length - 1 ? 'PF' : `PP${i}`,
          desc: i === celdas.length - 1 ? 'Promedio final' : `Promedio parcial ${i}`
        });
      }
    }

    if (ramNotas.length > 0 || nombreRamo.length > 3) {
      notas.push({ nombre: nombreRamo, notas: ramNotas });
    }
  }

  return notas;
}
