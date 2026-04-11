// api/napsis.js — flujo completo con captura correcta de PHPSESSID
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const NAPSIS_USER = process.env.NAPSIS_USER;
    const NAPSIS_PASS = process.env.NAPSIS_PASS;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

    if (!NAPSIS_USER || !NAPSIS_PASS) {
      return res.status(200).json({ notas: null, error: 'Credenciales no configuradas' });
    }

    // Rate limiting
    const cfgRes = await fetch(`${SUPABASE_URL}/rest/v1/config?clave=eq.napsis_ultima_consulta`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const cfgData = await cfgRes.json();
    if (cfgData?.length > 0) {
      const horas = (new Date() - new Date(cfgData[0].valor)) / 3600000;
      if (horas < 12) return res.status(200).json({ notas: null, mensaje: `Próxima en ${Math.round(12-horas)}h` });
    }

    const userB64 = Buffer.from(NAPSIS_USER).toString('base64');
    const passB64 = Buffer.from(NAPSIS_PASS).toString('base64');

    const hBase = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'es-CL,es-419;q=0.9',
      'Origin': 'https://login.napsis.com',
      'Referer': 'https://login.napsis.com/',
      'Host': 'manager2.inexoos.com'
    };

    // Función para extraer cookies de response headers
    const extractCookies = (response) => {
      const raw = response.headers.get('set-cookie') || '';
      return raw.split(',')
        .map(c => c.split(';')[0].trim())
        .filter(c => c.includes('='))
        .join('; ');
    };

    // PASO 1: valid-user
    const v = await fetch('https://manager2.inexoos.com/pil/valid-user', {
      method: 'POST',
      headers: { ...hBase, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ namePortal: 'napsis', username: userB64 })
    });
    const vData = await v.json().catch(() => ({}));

    // PASO 2: login
    const l = await fetch('https://manager2.inexoos.com/pil/login', {
      method: 'POST',
      headers: { ...hBase, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: NAPSIS_USER,
        usernameHash: userB64,
        password: passB64,
        token_recaptcha: null,
        usernameFront: vData?.nombreCompleto || 'NATALIA PAZ HERNANDEZ',
        infoPlatform: { url: 'https://login.napsis.com/', name: 'napsis', description: 'Napsis Spa' }
      })
    });
    const lData = await l.json();
    if (!lData?.data?.token) {
      return res.status(200).json({ notas: null, error: `Login falló: ${JSON.stringify(lData)}` });
    }
    const token = lData.data.token;

    // PASO 3: redirected-system — obtiene PHPSESSID para padres-apoderados
    const rdRes = await fetch('https://manager2.inexoos.com/pil/redirected-system', {
      method: 'POST',
      headers: { ...hBase, 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        id_country: '1',
        id_area: '1',
        id_system: '4',
        id_institution: '10657',
        id_profile: 'apoderado',
        token: token,
        url_login: 'https://login.napsis.com/'
      }),
      redirect: 'manual'
    });

    const rdData = await rdRes.json().catch(() => ({}));
    const rdCookies = extractCookies(rdRes);

    // El token de sesión puede venir en la respuesta o en cookies
    const sessionToken = rdData?.data?.token || rdData?.token || token;

    // PASO 4: activar sesión en padres-apoderados.napsis.cl
    const sesRes = await fetch(`https://padres-apoderados.napsis.cl/index/login/${sessionToken}`, {
      method: 'GET',
      headers: {
        'User-Agent': hBase['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es-419;q=0.9',
        'Referer': 'https://login.napsis.com/',
        'Cookie': rdCookies
      },
      redirect: 'follow'
    });

    // Capturar PHPSESSID de la respuesta
    const sesCookies = extractCookies(sesRes);
    const allCookies = [rdCookies, sesCookies].filter(Boolean).join('; ');

    // PASO 5: obtener las notas con las cookies de sesión
    const NOTAS_URL = 'https://padres-apoderados.napsis.cl/notas/22779097-0/3/2006/36026279/26503';
    const notasRes = await fetch(NOTAS_URL, {
      headers: {
        'Cookie': allCookies,
        'User-Agent': hBase['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://padres-apoderados.napsis.cl/',
        'Host': 'padres-apoderados.napsis.cl'
      }
    });

    if (!notasRes.ok) {
      return res.status(200).json({
        notas: null,
        error: `Notas HTTP ${notasRes.status}`,
        cookies: allCookies.slice(0, 100)
      });
    }

    const html = await notasRes.text();
    const notas = parsear(html);

    if (!notas?.length) {
      return res.status(200).json({
        notas: null,
        error: 'Sin notas en HTML',
        cookies: allCookies.slice(0, 100),
        debug: html.slice(0, 1000)
      });
    }

    await guardar(notas, SUPABASE_URL, SUPABASE_KEY);
    return res.status(200).json({
      notas,
      total: notas.reduce((s,r)=>s+r.notas.length,0),
      mensaje: `${notas.length} ramos actualizados`
    });

  } catch (e) {
    return res.status(200).json({ notas: null, error: e.message });
  }
}

function parsear(html) {
  const notas = [];
  const clean = s => s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
    if (cells.length < 2 || !cells[0] || cells[0].length < 3 || cells[0]==='Asignatura') continue;
    const ns = [];
    for (let i=1;i<cells.length;i++) {
      const v = parseFloat(cells[i].replace(',','.'));
      if (!isNaN(v) && v>=1&&v<=7) ns.push({val:v, tipo:i===cells.length-1?'PF':`PP${i}`, desc:i===cells.length-1?'Promedio final':`PP${i}`});
    }
    notas.push({nombre:cells[0], notas:ns});
  }
  return notas;
}

async function guardar(notas, url, key) {
  const h = {'apikey':key,'Authorization':`Bearer ${key}`,'Content-Type':'application/json'};
  await fetch(`${url}/rest/v1/notas_ramos?id=gte.0`,{method:'DELETE',headers:h});
  const flat=[];
  notas.forEach(r=>r.notas.forEach(n=>flat.push({ramo:r.nombre,val:n.val,tipo:n.tipo,descripcion:n.desc,fecha:new Date().toISOString().split('T')[0],semestre:1})));
  if (flat.length) await fetch(`${url}/rest/v1/notas_ramos`,{method:'POST',headers:{...h,'Prefer':'return=minimal'},body:JSON.stringify(flat)});
  await fetch(`${url}/rest/v1/config`,{method:'POST',headers:{...h,'Prefer':'resolution=merge-duplicates'},body:JSON.stringify({clave:'napsis_ultima_consulta',valor:new Date().toISOString()})});
}
