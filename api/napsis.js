// api/napsis.js
// Scraping de notas desde Napsis — flujo real observado con DevTools
// Flujo: valid-user → login (manager2.inexoos.com) → notas

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

    // Rate limiting
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/config?clave=eq.napsis_ultima_consulta`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const configData = await configRes.json();
    if (configData && configData.length > 0) {
      const horasDesde = (new Date() - new Date(configData[0].valor)) / (1000 * 60 * 60);
      if (horasDesde < 12) {
        return res.status(200).json({ notas: null, mensaje: `Próxima consulta en ${Math.round(12 - horasDesde)} horas` });
      }
    }

    const userB64 = Buffer.from(NAPSIS_USER).toString('base64');
    const passB64 = Buffer.from(NAPSIS_PASS).toString('base64');
    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'es-CL,es-419;q=0.9',
      'Origin': 'https://login.napsis.com',
      'Referer': 'https://login.napsis.com/'
    };

    // PASO 1: valid-user
    const validRes = await fetch('https://login.napsis.com/valid-user', {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ namePortal: 'napsis', username: userB64 })
    });
    const validData = await validRes.json();

    // PASO 2: login
    const loginRes = await fetch('https://manager2.inexoos.com/pil/login', {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/json', 'Host': 'manager2.inexoos.com' },
      body: JSON.stringify({
        username: NAPSIS_USER,
        usernameHash: userB64,
        password: passB64,
        token_recaptcha: null,
        usernameFront: validData?.nombreCompleto || 'NATALIA PAZ HERNANDEZ',
        infoPlatform: { url: 'https://login.napsis.com/', name: 'napsis', description: 'Napsis Spa' }
      })
    });
    const loginData = await loginRes.json();

    if (!loginData || !loginData.token) {
      return res.status(200).json({ notas: null, error: `Login falló: ${JSON.stringify(loginData)}` });
    }

    const token = loginData.token;

    // PASO 3: acceder a las notas de Martín
    const NOTAS_URL = 'https://padres-apoderados.napsis.cl/notas/22779097-0/3/2006/36026279/26503';
    const notasRes = await fetch(NOTAS_URL, {
      headers: {
        ...baseHeaders,
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://padres-apoderados.napsis.cl/'
      }
    });

    if (!notasRes.ok) {
      return res.status(200).json({ notas: null, error: `Notas HTTP ${notasRes.status}` });
    }

    const html = await notasRes.text();
    const notas = parsearNotasNapsis(html);

    if (!notas || notas.length === 0) {
      return res.status(200).json({ notas: null, error: 'Sin notas en HTML', debug: html.slice(0, 800) });
    }

    await guardarEnSupabase(notas, SUPABASE_URL, SUPABASE_KEY);

    return res.status(200).json({
      notas,
      total: notas.reduce((s, r) => s + r.notas.length, 0),
      mensaje: `${notas.length} ramos actualizados`
    });

  } catch (error) {
    return res.status(200).json({ notas: null, error: error.message });
  }
}

function parsearNotasNapsis(html) {
  const notas = [];
  const limpiar = s => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  for (const fila of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => limpiar(m[1]));
    if (celdas.length < 2 || !celdas[0] || celdas[0].length < 3 || celdas[0] === 'Asignatura') continue;
    const ramNotas = [];
    for (let i = 1; i < celdas.length; i++) {
      const v = parseFloat(celdas[i].replace(',', '.'));
      if (!isNaN(v) && v >= 1.0 && v <= 7.0)
        ramNotas.push({ val: v, tipo: i === celdas.length-1 ? 'PF' : `PP${i}`, desc: i === celdas.length-1 ? 'Promedio final' : `PP${i}` });
    }
    notas.push({ nombre: celdas[0], notas: ramNotas });
  }
  return notas;
}

async function guardarEnSupabase(notas, url, key) {
  const h = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
  await fetch(`${url}/rest/v1/notas_ramos?id=gte.0`, { method: 'DELETE', headers: h });
  const flat = [];
  notas.forEach(r => r.notas.forEach(n => flat.push({ ramo: r.nombre, val: n.val, tipo: n.tipo, descripcion: n.desc, fecha: new Date().toISOString().split('T')[0], semestre: 1 })));
  if (flat.length > 0) await fetch(`${url}/rest/v1/notas_ramos`, { method: 'POST', headers: { ...h, 'Prefer': 'return=minimal' }, body: JSON.stringify(flat) });
  await fetch(`${url}/rest/v1/config`, { method: 'POST', headers: { ...h, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ clave: 'napsis_ultima_consulta', valor: new Date().toISOString() }) });
}
