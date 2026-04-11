// api/partido-u.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) return res.status(200).json({ partido: null, error: 'API key no configurada' });

    const TEAM_ID = 1037;
    const offsetChile = -3;
    const ahora = new Date();
    const chileTime = new Date(ahora.getTime() + offsetChile * 60 * 60 * 1000);
    const hoy = chileTime.toISOString().split('T')[0];
    const manana = new Date(chileTime.getTime() + 86400000).toISOString().split('T')[0];

    const response = await fetch(`https://v3.football.api-sports.io/fixtures?team=${TEAM_ID}&next=3`, {
      headers: { 'x-apisports-key': apiKey }
    });

    if (!response.ok) throw new Error(`API-Football error: ${response.status}`);
    const data = await response.json();
    const fixtures = data.response || [];

    const proximo = fixtures.find(f => {
      const fecha = f.fixture.date.split('T')[0];
      return fecha === hoy || fecha === manana;
    });

    if (!proximo) return res.status(200).json({ partido: null });

    const horaUTC = new Date(proximo.fixture.date);
    const horaChile = new Date(horaUTC.getTime() + offsetChile * 60 * 60 * 1000);
    const hora = `${String(horaChile.getHours()).padStart(2,'0')}:${String(horaChile.getMinutes()).padStart(2,'0')}`;
    const esLocal = proximo.teams.home.id === TEAM_ID;
    const rival = esLocal ? proximo.teams.away.name : proximo.teams.home.name;

    const partido = {
      fecha: proximo.fixture.date.split('T')[0],
      hora, rival, esLocal,
      estadio: proximo.fixture.venue?.name || '',
      competicion: proximo.league?.name || 'Liga Chilena',
      nombre: `U. de Chile vs ${rival}`
    };

    // Guardar en Supabase
    const SUPABASE_URL = 'https://cayvrsqyjljqnrtsagwq.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheXZyc3F5amxqcW5ydHNhZ3dxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg0Nzc5NCwiZXhwIjoyMDkxNDIzNzk0fQ.m4hZ4VZXvHOGefATU892T092eWEDxQzEDynozA-xhFg';
    await fetch(`${SUPABASE_URL}/rest/v1/config`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ clave: 'partido_u', valor: JSON.stringify(partido) })
    });

    return res.status(200).json({ partido });
  } catch (error) {
    console.error('Error partido-u:', error);
    return res.status(200).json({ partido: null, error: error.message });
  }
}
