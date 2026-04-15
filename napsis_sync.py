"""
napsis_sync.py v2
Entra a Napsis evadiendo Cloudflare con modo stealth + URLs alternativas.
Sincroniza notas de Martín Vicente en Supabase.
"""
import os, re, time, json, requests
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

NAPSIS_URL   = os.environ.get("NAPSIS_URL",   "https://login.napsis.com/")
NAPSIS_USER  = os.environ.get("NAPSIS_USER",  "")
NAPSIS_PASS  = os.environ.get("NAPSIS_PASS",  "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://cayvrsqyjljqnrtsagwq.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

NAPSIS_URLS = [
    "https://padres-apoderados.napsis.cl/index/login",
    "https://cuentas.napsis.cl/",
    "https://login.napsis.com/",
]

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=ignore-duplicates",
}

STEALTH_JS = """
() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en-US', 'en'] });
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
    window.chrome = { runtime: {} };
}
"""

def shot(page, name):
    try:
        page.screenshot(path=f"step_{name}.png", full_page=True)
        print(f"  📸 {name}")
    except Exception:
        pass

def wait_load(page, timeout=10000):
    try:
        page.wait_for_load_state("load", timeout=timeout)
    except PWTimeout:
        pass

def fill_field(page, *selectors, value, timeout=5000):
    for sel in selectors:
        try:
            el = page.locator(sel).first
            el.wait_for(state="visible", timeout=timeout)
            el.fill(value)
            print(f"  ✅ Campo '{sel}' llenado")
            return True
        except PWTimeout:
            continue
    return False

def click_text(page, *texts, timeout=5000):
    for text in texts:
        try:
            el = page.locator(f"text={text}").first
            el.wait_for(state="visible", timeout=timeout)
            el.click()
            print(f"  ✅ Clic en '{text}'")
            return True
        except PWTimeout:
            continue
    return False

def tiene_cloudflare(page):
    content = page.content().lower()
    return ("verificación de seguridad" in content or
            "verifique que es un ser humano" in content or
            "checking your browser" in content)

def intentar_login(page, url):
    print(f"\n  🌐 Intentando: {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
    except Exception as e:
        print(f"  ⚠️ Error: {e}")
        return False
    time.sleep(3)
    shot(page, f"try_{url.split('/')[2].replace('.', '_')}")
    if tiene_cloudflare(page):
        print(f"  🚫 Cloudflare en {url}")
        return False
    email_ok = fill_field(
        page,
        "input[type='email']", "input[name='email']",
        "input[name='usuario']", "input[name='rut']",
        "input[placeholder*='correo' i]", "input[placeholder*='email' i]",
        "#email", "#usuario", "#rut",
        value=NAPSIS_USER, timeout=5000
    )
    if not email_ok:
        print(f"  ⚠️ Sin campo email en {url}")
        return False
    fill_field(
        page,
        "input[type='password']", "input[name='password']",
        "input[name='clave']", "#password", "#clave",
        value=NAPSIS_PASS, timeout=5000
    )
    shot(page, "formulario_llenado")
    for sel in ["button[type='submit']", "button:has-text('Ingresar')",
                "button:has-text('Iniciar sesión')", "button:has-text('Entrar')",
                "input[type='submit']", ".btn-primary"]:
        try:
            page.locator(sel).first.wait_for(state="visible", timeout=3000)
            page.locator(sel).first.click()
            print(f"  ✅ Botón login ({sel})")
            break
        except PWTimeout:
            continue
    else:
        page.keyboard.press("Enter")
    wait_load(page, 15000)
    time.sleep(4)
    shot(page, "post_login")
    if tiene_cloudflare(page):
        return False
    print(f"  ✅ Login exitoso en {url}")
    return True

def seleccionar_rol(page):
    print("\n👤 Seleccionando rol...")
    shot(page, "roles")
    if click_text(page, "Padres y apoderados", "Apoderado", "Padre", timeout=5000):
        wait_load(page)
        time.sleep(3)
        shot(page, "post_rol")
    else:
        print("  ℹ️  Sin pantalla de roles")

def seleccionar_alumno(page):
    print("\n👦 Seleccionando Martín Vicente...")
    shot(page, "alumnos")
    if click_text(page, "Martín Vicente", "Martin Vicente", timeout=5000):
        wait_load(page)
        time.sleep(3)
        shot(page, "post_alumno")
    else:
        print("  ℹ️  Sin selector de alumno")

def ir_a_notas(page):
    print("\n📊 Navegando a notas...")
    shot(page, "home")
    if click_text(page, "Notas", "Calificaciones", "Rendimiento", timeout=5000):
        wait_load(page)
        time.sleep(2)
        shot(page, "notas_menu")
        click_text(page, "Ver notas", "Historial", timeout=3000)
        wait_load(page, 8000)
        time.sleep(1)
    else:
        base = "/".join(page.url.split("/")[:3])
        for path in ["/calificaciones", "/notas", "/rendimiento", "/apoderado/calificaciones"]:
            try:
                page.goto(base + path, wait_until="domcontentloaded", timeout=10000)
                time.sleep(2)
                if page.query_selector("table"):
                    print(f"  ✅ Notas en {path}")
                    break
            except Exception:
                continue
    shot(page, "pagina_notas")

def parse_nota(text):
    text = text.strip().replace(",", ".")
    try:
        val = float(re.search(r"\d+\.?\d*", text).group())
        if 1.0 <= val <= 7.0:
            return val
    except (AttributeError, ValueError):
        pass
    return None

def extraer_notas_ramos(page):
    notas = []
    hoy = datetime.today().strftime("%Y-%m-%d")
    tablas = page.query_selector_all("table")
    print(f"\n  📋 Tablas: {len(tablas)}")
    for tabla in tablas:
        ramo = "Desconocido"
        try:
            cap = tabla.query_selector("caption")
            if cap:
                ramo = cap.inner_text().strip()
            else:
                prev = tabla.evaluate("""el => {
                    let n = el.previousElementSibling;
                    while(n) {
                        if(['H1','H2','H3','H4','H5','STRONG','B'].includes(n.tagName))
                            return n.innerText;
                        n = n.previousElementSibling;
                    }
                    return null;
                }""")
                if prev: ramo = prev.strip()
        except Exception:
            pass
        headers = [th.inner_text().strip().lower()
                   for th in tabla.query_selector_all("th")]
        if not headers:
            continue
        def col(names):
            for n in names:
                for i, h in enumerate(headers):
                    if n in h: return i
            return None
        idx_val   = col(["nota", "calificación", "calificacion", "val"])
        idx_tipo  = col(["tipo", "evaluación", "evaluacion", "descripcion"])
        idx_fecha = col(["fecha"])
        if idx_val is None:
            continue
        for fila in tabla.query_selector_all("tr")[1:]:
            celdas = [td.inner_text().strip() for td in fila.query_selector_all("td")]
            if not celdas or len(celdas) <= idx_val:
                continue
            val = parse_nota(celdas[idx_val])
            if val is None:
                continue
            tipo  = celdas[idx_tipo].lower().strip() if idx_tipo is not None and idx_tipo < len(celdas) else "napsis"
            fecha = celdas[idx_fecha].strip() if idx_fecha is not None and idx_fecha < len(celdas) else hoy
            notas.append({"ramo": ramo, "val": val, "tipo": tipo[:50],
                          "descripcion": tipo, "fecha": fecha or hoy})
    return notas

def extraer_promedios(page):
    promedios = {}
    ahora = datetime.utcnow().isoformat()
    for fila in page.query_selector_all("tr"):
        celdas = [td.inner_text().strip() for td in fila.query_selector_all("td")]
        if len(celdas) < 2 or len(celdas[0]) < 4 or celdas[0][0].isdigit():
            continue
        for c in celdas[1:]:
            val = parse_nota(c)
            if val is not None:
                promedios[celdas[0]] = {"asignatura": celdas[0], "promedio_periodo": val,
                                        "promedio_final": val, "periodo": 1, "fecha_sync": ahora}
                break
    return list(promedios.values())

def upsert(tabla, datos):
    if not datos:
        print(f"  ℹ️  Sin datos para {tabla}")
        return
    resp = requests.post(f"{SUPABASE_URL}/rest/v1/{tabla}",
                         headers=SB_HEADERS, json=datos, timeout=15)
    if resp.ok:
        print(f"  ✅ {len(datos)} registros → '{tabla}'")
    else:
        print(f"  ❌ Error '{tabla}': {resp.status_code} — {resp.text[:300]}")

def main():
    print("=" * 55)
    print(f"  🚀 Sync Napsis → Supabase | {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 55)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--window-size=1280,900",
            ]
        )
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 900},
            locale="es-CL",
            timezone_id="America/Santiago",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            extra_http_headers={
                "Accept-Language": "es-CL,es;q=0.9,en-US;q=0.8",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            }
        )
        ctx.add_init_script(STEALTH_JS)
        page = ctx.new_page()
        try:
            login_ok = False
            for url in NAPSIS_URLS:
                if intentar_login(page, url):
                    login_ok = True
                    break
            if not login_ok:
                raise Exception("Cloudflare bloqueó todas las URLs. Ver Opción B con cookies.")
            seleccionar_rol(page)
            seleccionar_alumno(page)
            ir_a_notas(page)
            shot(page, "final")
            notas_ramos = extraer_notas_ramos(page)
            promedios   = extraer_promedios(page)
            print(f"\n📌 Notas: {len(notas_ramos)} | Promedios: {len(promedios)}")
            for n in notas_ramos[:5]:
                print(f"   {n['ramo'][:35]:37s} {n['val']} ({n['tipo']})")
            upsert("notas_ramos", notas_ramos)
            upsert("notas", promedios)
        except Exception as e:
            print(f"\n💥 Error: {e}")
            shot(page, "99_error")
            raise
        finally:
            ctx.close()
            browser.close()
    print("\n🎉 ¡Listo!")

if __name__ == "__main__":
    main()
