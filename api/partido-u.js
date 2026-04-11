// api/partido-u.js
// Función serverless de Vercel
// Consulta API-Football para saber si la U juega hoy o mañana
// Se llama desde el dashboard cada vez que carga

export default async function handler(req, res) {
  // CORS para permitir llamadas desde GitHub Pages y Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      return res.status(200).json({ partido: null, error: 'API key no configurada' });
    }

    // Universidad de Chile = team ID 1037 en API-Football
    const TEAM_ID = 1037;

    // Calcular fechas: hoy y mañana en zona Chile (UTC-3/UTC-4)
    const ahora = new Date();
    const offsetChile = -3; // CLST en verano, -4 en invierno — usar -3 como base
    const chileTime = new Date(ahora.getTime() + offsetChile * 60 * 60 * 1000);
    const hoy = chileTime.toISOString().split('T')[0];
    const manana = new Date(chileTime.getTime() + 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    // Buscar partidos de los próximos 2 días
    const url = `https://v3.football.api-sports.io/fixtures?team=${TEAM_ID}&next=3`;
    const response = await fetch(url, {
      headers: {
        'x-apisports-key': apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`API-Football error: ${response.status}`);
    }

    const data = await response.json();
    const fixtures = data.response || [];

    // Buscar partido de hoy o mañana
    const partidoProximo = fixtures.find(f => {
      const fechaPartido = f.fixture.date.split('T')[0];
      return fechaPartido === hoy || fechaPartido === manana;
    });

    if (!partidoProximo) {
      return res.status(200).json({ partido: null });
    }

    // Formatear el partido
    const f = partidoProximo;
    const fechaPartido = f.fixture.date.split('T')[0];

    // Hora en Chile
    const fechaUTC = new Date(f.fixture.date);
    const horaChile = new Date(fechaUTC.getTime() + offsetChile * 60 * 60 * 1000);
    const hora = `${String(horaChile.getHours()).padStart(2,'0')}:${String(horaChile.getMinutes()).padStart(2,'0')}`;

    // Determinar rival (la U puede ser local o visita)
    const esLocal = f.teams.home.id === TEAM_ID;
    const rival = esLocal ? f.teams.away.name : f.teams.home.name;
    const esLocal2 = esLocal ? 'vs' : 'en';

    const partido = {
      fecha: fechaPartido,
      hora,
      rival,
      esLocal,
      estadio: f.fixture.venue?.name || '',
      ciudad: f.fixture.venue?.city || '',
      competicion: f.league?.name || 'Liga Chilena',
      nombre: `U. de Chile ${esLocal2} ${rival}`
    };

    // Guardar en Supabase para que el dashboard lo lea rápido
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (supabaseUrl && supabaseKey) {
      await fetch(`${supabaseUrl}/rest/v1/config`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          clave: 'partido_u',
          valor: JSON.stringify(partido),
          updated_at: new Date().toISOString()
        })
      });
    }

    return res.status(200).json({ partido });

  } catch (error) {
    console.error('Error partido-u:', error);
    return res.status(200).json({ partido: null, error: error.message });
  }
}
