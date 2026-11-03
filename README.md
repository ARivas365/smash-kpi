# Smash KPI

App (PWA) para registrar y analizar KPIs de partidas de Super Smash Bros. Ultimate desde el teléfono.
Funciona 100% offline, sin cuentas ni servidores: los datos quedan guardados **solo en tu teléfono** (IndexedDB).

---

## 1. Publicarla gratis en GitHub Pages

Lo hacés una sola vez, desde la PC.

### a) Crear la cuenta
1. Entrá a <https://github.com> → **Sign up** y creá tu cuenta (es gratis).
2. Tu **nombre de usuario** va a formar parte de la dirección de la app. Ejemplo: si sos `alvaro123`, la app va a quedar en `https://alvaro123.github.io/smash-kpi/`.

### b) Crear el repositorio (la "carpeta" en GitHub)
1. Arriba a la derecha, botón **+** → **New repository**.
2. **Repository name**: `smash-kpi`
3. Marcá **Public** (GitHub Pages gratis necesita que sea público. Solo se publica el código de la app; **tus partidas nunca se suben**: viven en el teléfono).
4. Botón **Create repository**.

### c) Subir los archivos
1. En la página del repositorio recién creado, hacé clic en el link **uploading an existing file**.
2. Abrí en el Explorador de Windows la carpeta `smash-kpi` y **seleccioná todo lo que hay adentro** (no la carpeta en sí):
   `css`, `data`, `icons`, `img`, `js`, `index.html`, `manifest.json`, `sw.js`, `README.md`
3. Arrastralo todo junto a la página de GitHub. Las carpetas se suben con su contenido.
4. Abajo, botón verde **Commit changes**.

> Revisá que en el repositorio se vean `index.html` y las carpetas `css`, `img`, `js` e `icons` en la raíz. Si quedó todo adentro de una carpeta `smash-kpi/`, la app no va a abrir: borrá y volvé a subir solo el contenido.

### d) Activar GitHub Pages
1. En el repositorio: **Settings** (pestaña de arriba) → en el menú izquierdo, **Pages**.
2. En **Source** elegí **Deploy from a branch**.
3. En **Branch** elegí **main** y la carpeta **/ (root)** → **Save**.
4. Esperá 1 o 2 minutos y recargá esa página: arriba va a aparecer *"Your site is live at https://TU-USUARIO.github.io/smash-kpi/"*.

---

## 2. Instalarla en el teléfono con Brave

1. En el Samsung abrí **Brave** y entrá a `https://TU-USUARIO.github.io/smash-kpi/`.
2. Esperá a que cargue del todo (unos segundos: en ese momento se guarda para funcionar sin internet).
3. Tocá el menú **⋮** (abajo a la derecha o arriba, según cómo tengas configurada la barra).
4. Elegí **"Instalar app"** o **"Agregar a la pantalla de inicio"** → **Instalar / Agregar**.
5. Listo: aparece el ícono **Smash KPI** en la pantalla de inicio y abre a pantalla completa, sin barra del navegador.

Los **Shields de Brave pueden quedar activados**: la app no usa nada externo (ni fuentes, ni CDN, ni analytics). La única conexión de afuera es opcional: la API de start.gg, si cargás tu token para bajar tus torneos.

Para probar que anda offline, poné el modo avión y abrila desde el ícono.

### Cuidado con los datos
- Los datos viven dentro de Brave. **Si borrás los datos de navegación de Brave** (o tenés activado "Borrar datos al salir"), **se pierden**.
- Por eso la app te avisa en **Ajustes** si pasaron más de 7 días sin respaldo (aparece un punto amarillo en la pestaña).
- **Ajustes → Respaldo completo → Compartir** abre el menú de compartir de Android: mandalo a WhatsApp (por ejemplo, a tu propio chat) o guardalo en Drive.
- Para recuperar: **Ajustes → Importar → Elegir archivo JSON** y elegí *Combinar* o *Reemplazar*.
- Si compartir un `.json` no está disponible, la app lo manda como `.json.txt`. Se importa igual.
- **Google Drive:** **Ajustes → Google Drive → Conectar Google Drive y respaldar**. Cada persona usa su propia cuenta de Google y el respaldo queda en una carpeta "Smash KPI" de su Drive (la app solo ve esa carpeta). Si pasan 14 días, al abrir la app aparece un aviso para respaldar con un toque. **Recuperar** lista los últimos 10 respaldos para importarlos.

---

## 3. Actualizar la app más adelante

1. En GitHub, dentro del repositorio: **Add file → Upload files**, arrastrá los archivos modificados (con sus carpetas) → **Commit changes**.
2. En el teléfono, abrí la app **dos veces**: la primera descarga la versión nueva en segundo plano y la segunda ya la muestra.

Los datos no se tocan al actualizar.

---

## 4. Uso rápido

| Pestaña | Para qué |
|---|---|
| **Cargar** | Un game en menos de un minuto. Resultado: **Gané / Perdí** y al lado los stocks que le quedaron al ganador (**1 · 2 · 3**). En Bo3 solo aparecen G1 a G3. Al guardar pasa solo al siguiente game del set (con rival y personajes ya puestos, y los datos del set resumidos en una línea), o a un set nuevo si el set terminó según su formato (Bo3/Bo5). Durante unos segundos aparece **Deshacer** por si te equivocaste. Recovery y Limit quedan en una sección plegable que recuerda si la dejaste abierta. En **Torneo** te guía con los baneos de stages (G1: piedra, papel o tijeras 1-2-1; G2+: el ganador banea 3 y el perdedor elige; con un solo Steve, elige el que no usa Steve). Cuando te toca banear o elegir, te sugiere qué stages según tu récord con tu personaje vs el del rival, y cada stage muestra ese récord. |
| **Estadísticas** | Filtros, Foco de la semana, KPIs, patrones (por game, remontadas, quién eligió el stage, cansancio), gráficos por semana, **Matchups** y **Stages** (los peores en rojo) y **Cloud vs Steve**. |
| **Historial** | Sets agrupados. Tocá uno para ver sus games, **editarlos**, **borrarlos** o agregar otro game. |
| **Notas** | Notas por **matchup** (ej. Cloud vs Pikachu) y por **jugador**, con tu récord arriba y las notas de los games que les corresponden. También todas las notas de games con buscador y las **guías de Mr.E** (81 personajes + fundamentos), que se pueden usar como base de una nota de matchup. Al cargar un game, si tenés nota del rival o del matchup, aparece un resumen. |
| **Ajustes** | Respaldo JSON/CSV, importar, torneos de start.gg (token y actualización), main/secundario, stocks y datos de ejemplo. |

- ⚠ junto a un dato = menos de 5 games: no saques conclusiones todavía.
- El CSV usa `;` como separador (lo abren directo Excel en español y Google Sheets).
- Datos de ejemplo: **Ajustes → Cargar datos de ejemplo** para ver cómo queda, y después **Borrar datos de ejemplo** (no toca tus games reales).

### Torneos de start.gg
- La app no trae datos de nadie: cada persona conecta su cuenta y baja sus propios torneos (stage, personajes y resultado de cada game), que se suman a sus estadísticas. Filtrá por **Origen** para separarlos de lo que cargás a mano.
- **Ajustes → Torneos de start.gg** → pegá un token de la API (start.gg → perfil → Developer Settings → Create new token) → **Guardar y bajar mis torneos**. La app detecta sola de quién es el token (no hace falta buscar el ID). Después busca torneos nuevos una vez por día al abrir la app, o cuando tocás **Actualizar ahora**.
- El token queda guardado solo en el teléfono y no se incluye en los respaldos.
- **Scouting de rivales:** en **Cargar**, al escribir el rival aparece **🔎 Scouting de … en start.gg** (también en su nota de jugador). Trae sus últimos 40 sets: personajes, en qué stages gana y pierde, qué stages elige de counterpick, torneos recientes y tu récord contra él. Lo busca entre tus rivales y entre los inscriptos de tus últimos torneos; si no aparece, se pega el link de su perfil de start.gg. El informe queda guardado para verlo sin internet y se puede pasar a su nota.
- **Sets cargados a mano que después bajan de start.gg:** no se duplican. Si coinciden el rival, el día (o el siguiente) y el resultado de cada game, se unen solos: queda tu set con baneos, %, openings, Limit y notas, y se le suma el torneo, la ronda y los games que no cargaste. Si no coinciden del todo, aparecen en **Historial → Posibles duplicados** para **Unir** o marcar **Son distintos**. Al empezar a cargar en modo Torneo un set que ya bajó de start.gg, la app avisa y ofrece completarlo.
- Al cargar un game, en **Personaje del rival** se sugieren solo los personajes que ese rival suele usar (de tus games, sus torneos y su scouting). **Buscar…** sigue disponible para cualquier otro.

---

## 5. Estructura

```
index.html          pantalla principal
manifest.json       datos para instalarla como app
sw.js               service worker (modo offline)
css/app.css         estilos (tema oscuro)
js/app.js           interfaz y lógica de pantallas
js/stats.js         cálculo de KPIs
js/charts.js        gráficos SVG (sin librerías)
js/db.js            base de datos local (IndexedDB)
js/data.js          roster, stages y definición de KPIs
js/sample.js        generador de datos de ejemplo
js/stages.js        qué imagen usa cada stage
js/startgg.js       sincronización con la API de start.gg y scouting de rivales
js/drive.js         respaldo en Google Drive (OAuth en el navegador)
img/stages/         imágenes de los stages (480 px, JPG)
data/mre.json       guías de matchups y fundamentos de Mr.E
icons/              íconos de la app
```
