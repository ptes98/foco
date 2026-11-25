# Foco

PWA estática en español. Los recuentos, el registro y todo lo personal se guardan en el navegador del dispositivo y no salen de él. La semana empieza el lunes. El enlace «Mi Hoy» abre Notion y depende de los permisos de esa página.

## Instalar en iPhone

Abre [Foco](https://ptes98.github.io/foco/) en Safari. Toca **Compartir → Añadir a pantalla de inicio**. Si ves **Abrir como app web**, déjalo activado. Abre Foco una vez desde el icono con conexión para preparar el acceso sin red.

## Cómo funciona

En cada apertura, Foco elige al azar entre dos pantallas y lo apunta en el registro:

- **Menú** (variante de control): «¿A qué venías?» con «Mi Hoy», «10 min de algo físico» y «Descanso 5 min sin móvil».
- **Tarjeta**: una acción de 1–3 min para el sitio elegido (por defecto Casa, Taller, Campo y Cansado; recuerda el último). Deslizar u «Otra» enseña otra, 3 como mucho; después, «Ya está: elige una o cierra». «Hecho» gira la tarjeta, pone un ladrillo en la pared de la semana y termina con «Listo, puedes dejar el móvil». No hay temporizador.

Cuenta como apertura abrir Foco tras 2 min o más sin verla. Si una sesión del menú o una tarjeta se quedó a medias más de 30 min, Foco pregunta si se hizo antes de seguir. Durante 600 ms después de cambiar de pantalla se ignoran los toques, para que un doble toque no active otro botón.

Para ver una pantalla concreta sin sorteo: [`?variante=tarjeta`](https://ptes98.github.io/foco/?variante=tarjeta) o [`?variante=menu`](https://ptes98.github.io/foco/?variante=menu).

## Hacerlo tuyo

- **Primera vez** (solo en la variante tarjeta): se eligen los sitios, qué tarjetas de «Cansado» valen y algunas acciones pequeñas de las aficiones. Se puede saltar y se repite desde «Mis tarjetas → Cambiar sitios y descanso».
- **Mis tarjetas**: añadir a mano, borrar (con confirmación), quitar tarjetas de ejemplo e importar o copiar. El formato de importación es una tarjeta por línea, `Sitio | min | texto`; también vale un JSON con una lista de `{contexto, texto, min}`. Un sitio nuevo se crea solo.
- **Mi semana**: la pared de ladrillos, uno por «Hecho» y día, y lo hecho cada día. Se abre desde «Mi semana» o tocando «N hechas hoy».

Las tarjetas propias, los sitios y las tarjetas de ejemplo quitadas viven solo en el `localStorage` del dispositivo. Este repositorio es público: **no se debe subir aquí nada personal**. `tarjetas.json` solo lleva tarjetas de ejemplo genéricas.

## Registro

«Copiar registro» copia un JSON con los eventos de los últimos 21 días: `abrir`, `ver_menu`, `ver_tarjeta`, `deslizar`, `contexto`, `fin_mazo`, `elegir`, `hecho`, `no_hecho`, `pregunta`, `descanso_fin`, `volver`, `salir`, `config_ver`, `config`, `mis_ver`, `tarjeta_nueva`, `importar` y `semana_ver`. Cada evento lleva hora local, apertura (`ap`), variante (`var`) y, cuando aplica, contexto (`ctx`) y segundos desde que se mostró (`s`).

## Cambiar las tarjetas de ejemplo y las tareas

- `tarjetas.json`: lista de tarjetas con `contexto` (Casa, Taller, Campo o Cansado), `tipo`, `texto`, `min` e `id`. El `id` identifica la tarjeta en el registro y en las tarjetas quitadas; si se cambia el texto, conviene cambiar también el `id`.
- `tareas.json`: lista de textos para «10 min de algo físico».

## Publicación

GitHub Pages publica la raíz de la rama `main`. Los recursos usan rutas relativas para que la app también funcione dentro de una subcarpeta. El service worker (caché `v3`) responde desde la caché al momento y actualiza en segundo plano, así que una versión nueva se ve en la apertura siguiente a la primera con conexión. La rama `version-anterior` conserva la versión de antes de la tarjeta.

Para previsualizar, sirve la carpeta por HTTP. `localhost` o HTTPS permiten probar la caché sin conexión. El temporizador del menú se recalcula al volver a la app; un iPhone puede suspender JavaScript mientras está bloqueado y una web no puede avisar al acabar sin un servidor de avisos push.
