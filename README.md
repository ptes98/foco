# Foco

PWA estática en español. Los recuentos se guardan en el navegador del dispositivo. La semana empieza el lunes. El enlace «Mi Hoy» abre Notion y depende de los permisos de esa página.

## Instalar en iPhone

Abre [Foco](https://ptes98.github.io/foco/) en Safari. Toca **Compartir → Añadir a pantalla de inicio**. Si ves **Abrir como app web**, déjalo activado. Abre Foco una vez desde el icono con conexión para preparar el acceso sin red.

## Cambiar las tareas

Edita `tareas.json` y conserva la lista JSON de textos entre comillas, separados por comas. Cada pulsación de «10 min de algo físico» elige una entrada al azar. «Hecho» añade una tarea al recuento.

## Publicación

Para publicar una actualización, actualiza los archivos en la raíz de `ptes98/foco`, rama `main`. GitHub Pages publica esa raíz. Los recursos usan rutas relativas para que la app también funcione dentro de una subcarpeta.

Para previsualizar, sirve la carpeta por HTTP. `localhost` o HTTPS permiten probar la caché sin conexión. El temporizador se recalcula al volver a la app. Un iPhone puede suspender JavaScript mientras está bloqueado.
