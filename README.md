# Chatea — chat grupal con videollamadas WebRTC

Chat grupal en navegador con WebSocket y videollamadas grupales mediante WebRTC. El contenido audiovisual viaja por WebRTC; el WebSocket existente transporta el chat y la señalización.

## Requisitos e instalación

- Node.js 24 y npm.
- Cámara y micrófono para probar llamadas. `getUserMedia` requiere HTTPS en dispositivos externos; `localhost` funciona como contexto seguro.

```powershell
npm install
npm start
```

Abre <http://localhost:3000>. El puerto predeterminado es 3000 y se puede cambiar con `$env:PORT=3001; npm start`. Para desarrollo usa `npm run dev`; Nodemon observa solo `server/`, agrupa cambios durante 750 ms e ignora el frontend, pruebas y archivos de documentación para evitar reinicios por cambios que no requieren reiniciar Node. El frontend se sirve estáticamente, así que sus cambios se reflejan al recargar el navegador. Estado HTTP en `/health` y WebSocket en `/ws`.

## Uso

Abre varias ventanas o navegadores y entra con nombres diferentes. Pulsa **Iniciar llamada** para abrir una llamada en la sala; las demás personas conectadas reciben el aviso **Unirse**. Cada participante permite cámara y micrófono al entrar. Usa **Finalizar llamada** para salir; la llamada continúa para quienes siguen dentro. Al salir el último participante, la llamada termina. Cerrar la videollamada libera las pistas y la conexión WebRTC, mientras que el chat WebSocket continúa disponible.

Los indicadores distinguen el estado del WebSocket del estado de la videollamada. El chat conserva mensajes grupales, presencia, respuestas, reacciones, edición, eliminación, fijado, escritura, búsqueda y reconexión. Las acciones de cada mensaje están en el botón de opciones; cualquier participante puede fijar un mensaje y ese fijado reemplaza al anterior para toda la sala. Solo puede haber un mensaje fijado a la vez.

El compositor permite adjuntar hasta cinco imágenes JPG, PNG, GIF o WebP de máximo 5 MB cada una. Al pulsar el clip aparece primero un modal que explica los formatos y límites; **Continuar** abre el selector de fotos y **Cancelar** lo cierra. El cliente y el servidor validan tipo y tamaño, y el servidor comprueba también la firma del formato. `POST /api/uploads?name=...` recibe el binario con `Content-Type` y `X-Chat-User-Id`; responde `201` con `attachment` (id, nombre, tipo, tamaño y URL). El evento WebSocket `message:new` referencia esos archivos con `attachments: [id, ...]`. Las cargas muestran progreso y permiten reintentar o quitar una imagen si fallan. Las imágenes se guardan en el sistema de archivos local; la carpeta predeterminada es `.chat-uploads` y se puede cambiar con `UPLOAD_DIR`. El historial y el registro de adjuntos permanecen en memoria, así que el chat no recupera mensajes ni referencias a archivos después de reiniciar.

Para un despliegue en Docker, define `UPLOAD_DIR` como la ruta del volumen montado en el contenedor. Los volúmenes nombrados de Docker conservan sus datos aunque se elimine el contenedor; por ejemplo, en Compose se puede montar `chat-uploads:/app/data/uploads` y definir `UPLOAD_DIR=/app/data/uploads`. El volumen conserva los binarios, pero no hace persistente el historial ni el registro de adjuntos de esta aplicación.

## Pruebas

```powershell
npm test
```

La prueba automatizada existente cubre el protocolo WebSocket del chat y `/health`. La señalización puede probarse entre dos clientes conectados; la captura real de cámara, micrófono, negociación ICE y acceso desde un teléfono queda **pendiente de validación manual** en dos navegadores y dispositivos disponibles.

## Probar en dos dispositivos por HTTPS

1. Inicia el servidor en el puerto 3000.
2. Expón ese puerto con un túnel HTTPS de tu elección (por ejemplo, ngrok autenticado, Cloudflare Tunnel o VS Code Port Forwarding).
3. Abre la URL HTTPS del túnel en ambos dispositivos. El cliente cambia automáticamente de `ws:` a `wss:`.
4. Acepta los permisos de cámara/micrófono y prueba iniciar la llamada, unirse desde los demás dispositivos y salir. No hay URL ni credenciales de túnel incluidas en el repositorio.

## ICE y conectividad

El cliente usa el STUN público parametrizado en `public/js/webrtc.js` (`ICE_SERVERS`) para descubrir rutas. STUN por sí solo no garantiza conexión entre todas las redes. Para TURN, configura un servidor propio y agrega sus URL y credenciales en `ICE_SERVERS` mediante configuración local; no guardes credenciales en el repositorio. El contrato WebSocket de llamadas usa `call:start` para iniciar la llamada de sala, `call:available` para anunciarla a quienes pueden unirse, `call:join` para entrar y `call:end` para salir. `webrtc:offer`, `webrtc:answer` y `webrtc:ice-candidate` llevan señalización privada entre participantes; el servidor deriva el emisor de la sesión registrada.

Para evitar ráfagas, el cliente y el servidor limitan a 12 mensajes por usuario cada 10 segundos. El servidor aplica el límite también entre pestañas que comparten una identidad y devuelve el tiempo de espera restante.

## Estructura

- `server/server.js`: Express, HTTP y WebSocket.
- `server/socket/connectionHandler.js`: conexión, heartbeat y despacho de eventos.
- `server/socket/callHandler.js`: entrada a llamadas de sala, ocupación, privacidad de señalización y limpieza.
- `server/services/`: usuarios y mensajes en memoria.
- `public/js/socket.js`: transporte WebSocket y reconexión.
- `public/js/app.js`: composición de features y dependencias compartidas.
- `public/js/features/`: `ChatFeature`, `RosterFeature`, `PresenceFeature`, `CallFeature` y `SessionFeature`, cada una dueña de sus eventos y controles.
- `public/js/ui.js`: renderizado y utilidades DOM; `webrtc.js` encapsula el ciclo de vida de `RTCPeerConnection` y los medios.
- `server/services/callService.js`: estado y ciclo de vida de sesiones de llamada; `server/socket/callHandler.js` autentica y enruta eventos.
- `public/css/style.css`: estilos responsivos.
- `tests/websocket.test.js`: prueba automatizada del chat existente.

## Diagnóstico y límites

- Si no inicia audio/video, revisa permisos del navegador y que existan dispositivos disponibles.
- En una página que no sea HTTPS/localhost, `getUserMedia` puede estar bloqueado.
- Si queda conectando, prueba otra red o configura TURN; algunas redes bloquean rutas P2P.
- Solo puede haber una llamada de sala a la vez y el servidor conserva su estado en memoria. No hay autenticación de cuentas ni historial persistente; usa el servicio en una red de confianza.
- La biblioteca Lucide se carga desde un CDN para los iconos de interfaz.

## Organización del código

El punto de composición crea el transporte compartido y conecta features independientes. Las features siguen un patrón de módulos por capacidad y observan eventos mediante `EventTarget`; `CallFeature` delega recursos multimedia a `VideoCall` y el servidor delega las transiciones a `CallService`. Las sesiones de llamada tienen un dueño único en el servicio, mientras que el estado de mensajes y presencia vive en sus features correspondientes. No se añade un framework de estado global para mantener pequeña la arquitectura.
