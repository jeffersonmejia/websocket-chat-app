# Chatea: chat grupal con WebRTC y procesamiento paralelo de imágenes

## 1. Resumen general

Chatea es una aplicación web de chat grupal en tiempo real. Los clientes se conectan al servidor mediante WebSocket para intercambiar mensajes, presencia y señalización de llamadas. El audio y el video se transmiten entre navegadores mediante WebRTC. Las imágenes adjuntas se validan en el servidor, se procesan mediante un pool de `worker_threads` y se guardan en el sistema de archivos local.

La aplicación ofrece mensajes, respuestas citadas, búsqueda, edición, eliminación, reacciones, un mensaje fijado compartido, indicador de escritura, presencia, carga de imágenes con progreso, videollamadas grupales, reconexión WebSocket y procesamiento de imágenes en paralelo.

## 2. Tecnologías y librerías

### 2.1 Tecnologías principales

| Tecnología | Uso |
| --- | --- |
| Node.js 24 o superior | Runtime del servidor, módulos ES, API HTTP y `worker_threads`. |
| JavaScript ES Modules | Organización del backend y frontend con `import` y `export`. |
| Express 5 | Rutas HTTP para salud y carga, descarga y eliminación de imágenes. |
| WebSocket (`ws`) | Chat, presencia, eventos de llamada y señalización WebRTC. |
| WebRTC del navegador | Audio y video entre participantes mediante `RTCPeerConnection`. |
| HTML y CSS | Interfaz accesible y adaptable a pantallas grandes y pequeñas. |
| Web Workers de Node.js (`worker_threads`) | Procesamiento de imágenes fuera del hilo principal del servidor. |

### 2.2 Dependencias del proyecto

Versiones declaradas en [`package.json`](package.json):

| Paquete | Versión declarada | Tipo | Función |
| --- | --- | --- | --- |
| `express` | `^5.3.0` | Producción | Servidor HTTP y rutas REST. |
| `ws` | `^8.22.0` | Producción | Servidor WebSocket. |
| `sharp` | `^0.35.5` | Producción | Lectura, redimensionamiento y compresión de imágenes dentro de los workers. |
| `nodemon` | `^3.1.14` | Desarrollo | Reinicio del servidor cuando cambia el código del backend. |

La interfaz usa **Lucide 0.468.0** desde CDN para los iconos; no está instalada como dependencia npm. WebRTC, `RTCPeerConnection`, `getUserMedia`, `EventTarget`, `fetch` y `WebSocket` son APIs nativas del navegador.

## 3. Requisitos e instalación

### 3.1 Requisitos

- Node.js 24 o superior y npm.
- Navegador moderno para el chat.
- Cámara y micrófono para probar videollamadas.
- `localhost` o HTTPS para permitir acceso a cámara y micrófono. Los dispositivos externos requieren HTTPS.

### 3.2 Instalar y ejecutar

Desde la raíz del proyecto:

```powershell
npm install
npm start
```

Abre <http://localhost:3000>. Para cambiar el puerto en PowerShell:

```powershell
$env:PORT=3001
npm start
```

Para desarrollo:

```powershell
npm run dev
```

El frontend se sirve como archivos estáticos; recarga el navegador para ver sus cambios. Nodemon reinicia el backend al detectar cambios en el servidor. La ruta HTTP `/health` responde el estado del proceso y `/ws` acepta conexiones WebSocket.

### 3.3 Variables de entorno

| Variable | Valor predeterminado | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP del servidor. |
| `UPLOAD_DIR` | `.chat-uploads` en la raíz del proyecto | Directorio donde se guardan los binarios de imagen. |

En Docker, asigna `UPLOAD_DIR` a una ruta montada en un volumen, por ejemplo `/app/data/uploads`. El volumen conserva los binarios al reemplazar el contenedor. Los mensajes, usuarios y referencias de adjuntos se guardan en memoria y no sobreviven al reinicio.

## 4. Arquitectura de ejecución

### 4.1 Inicio del servidor

1. `server/server.js` crea Express, `UserService`, `ChatService`, el procesador de imágenes y `UploadService` ([líneas 14–21](server/server.js#L14)).
2. Express registra las rutas de archivos y `/health` ([líneas 22–50](server/server.js#L22)).
3. Node crea el servidor HTTP y el servidor WebSocket `ws`; el WebSocket limita cada frame a 65 536 bytes ([líneas 55–62](server/server.js#L55)).
4. El servidor escucha en `PORT` o `3000` ([líneas 69–72](server/server.js#L69)).
5. Al recibir `SIGINT` o `SIGTERM`, cierra clientes y workers y espera el cierre HTTP ([líneas 73–83](server/server.js#L73)).

### 4.2 Composición del cliente

`public/index.html` declara la pantalla de ingreso, la sala, el compositor, el modal de adjuntos y la vista de llamada ([líneas 8–11 y 33–83](public/index.html#L8)). `public/js/app.js` crea un transporte WebSocket compartido y conecta las features independientes ([líneas 9–18](public/js/app.js#L9)).

Cada feature escucha los eventos relevantes y administra su estado. `public/js/ui.js` contiene funciones de presentación y manipulación del DOM. `public/css/style.css` define el diseño responsivo.

### 4.3 Flujo de una conexión WebSocket

1. `public/js/features/sessionFeature.js` inicia o restaura la identidad del usuario y solicita unirse.
2. `public/js/socket.js` abre `/ws`, serializa eventos, permite enviar mensajes y programa la reconexión ([líneas 1–41](public/js/socket.js#L1)).
3. `server/socket/connectionHandler.js` analiza cada frame, identifica la sesión registrada, mantiene heartbeat y despacha eventos ([líneas 7–60](server/socket/connectionHandler.js#L7)).
4. `server/socket/userHandler.js` registra el ingreso, sincroniza mensajes y usuarios, y publica cambios de presencia ([líneas 3–17](server/socket/userHandler.js#L3)).
5. `server/utils/events.js` centraliza nombres de eventos, límites y validación de frames ([líneas 1–47](server/utils/events.js#L1)).

El WebSocket transporta datos de chat y señalización. **No transporta el audio ni el video.**

## 5. Funciones y cómo están implementadas

### 5.1 Ingreso, usuarios y presencia

1. El usuario elige un nombre y el cliente conserva una identidad para reconectarse.
2. El cliente se registra mediante el evento de ingreso de WebSocket.
3. `server/services/userService.js` administra usuarios conectados, nombres, presencia e identidad asociada a cada socket ([líneas 4–31](server/services/userService.js#L4)).
4. `server/socket/userHandler.js` responde con la lista inicial de personas y el historial en memoria; luego distribuye entradas, salidas y cambios de presencia.
5. `public/js/features/rosterFeature.js`, `presenceFeature.js` y `sessionFeature.js` actualizan la lista, el estado en línea/ausente y el ciclo de vida de la sesión.

### 5.2 Mensajes, respuestas y acciones

1. `ChatFeature` obtiene el texto, respuestas citadas y referencias de adjuntos y envía `message:new` ([`chatFeature.js`, líneas 4–32 y 128–154](public/js/features/chatFeature.js#L4)).
2. `server/socket/messageHandler.js` valida que el usuario esté registrado y procesa cada evento del chat ([líneas 3–45](server/socket/messageHandler.js#L3)).
3. `server/services/chatService.js` administra mensajes en memoria y sus operaciones: crear, editar, borrar, reaccionar y fijar ([líneas 4–64](server/services/chatService.js#L4)).
4. `public/js/ui.js` dibuja mensajes, adjuntos, respuestas citadas, reacciones y acciones ([líneas 57–198](public/js/ui.js#L57)).
5. Al fijar un mensaje, `ChatService` quita el fijado anterior antes de establecer el nuevo. Por eso solo existe un mensaje fijado a la vez en la sala.
6. Cada usuario puede tener una sola reacción activa por mensaje. Al escoger otra, el servicio elimina su reacción anterior antes de guardar la nueva.

El historial tiene un máximo de 200 mensajes ([`server/utils/events.js`, línea 11](server/utils/events.js#L11)). El límite de texto es 2000 caracteres ([línea 2](server/utils/events.js#L2)). No hay base de datos: al reiniciar el servidor se pierde el historial.

### 5.3 Indicador de escritura y límite de mensajes

1. `ChatFeature` emite `typing:start` al escribir y `typing:stop` al dejar de hacerlo ([`chatFeature.js`, líneas 117–126](public/js/features/chatFeature.js#L117)).
2. `server/socket/messageHandler.js` retransmite el estado y usa un temporizador para borrar indicadores que no recibieron el evento de parada ([líneas 35–44](server/socket/messageHandler.js#L35)).
3. `public/js/ui.js` representa el indicador y las fotos/iniciales de quienes escriben ([líneas 205–228](public/js/ui.js#L205)).
4. `server/services/messageRateLimiter.js` limita la frecuencia de mensajes para reducir spam ([líneas 2–20](server/services/messageRateLimiter.js#L2)).

El límite es 12 mensajes por usuario cada 10 segundos. El texto y el tamaño máximo del frame WebSocket se validan en `server/utils/events.js`.

### 5.4 Adjuntar, validar y servir imágenes

#### 5.4.1 Selección y carga en el navegador

1. El botón del clip abre primero un modal que explica formatos admitidos y límites; **Continuar** abre el selector y **Cancelar** cierra el modal ([`public/index.html`, líneas 48–54 y 75–84](public/index.html#L48)).
2. `ChatFeature` comprueba el número y tamaño de imágenes, mantiene la cola visual y sube cada archivo mediante `POST /api/uploads` ([`chatFeature.js`, líneas 155–174 y 179–242](public/js/features/chatFeature.js#L155)).
3. El navegador muestra progreso, error, reintento o eliminación en la cola ([líneas 244–273](public/js/features/chatFeature.js#L244)).
4. Después de que el servidor responde, el mensaje WebSocket incluye los IDs de adjunto, no el binario de imagen ([líneas 128–154](public/js/features/chatFeature.js#L128)).

#### 5.4.2 Validación, almacenamiento y descarga

1. `POST /api/uploads` limita el cuerpo HTTP a 5 MB y requiere una identidad conectada ([`server/server.js`, líneas 22–28](server/server.js#L22)).
2. `UploadService` limita cada imagen a 5 MB, permite hasta 5 adjuntos por mensaje, acepta JPEG/PNG/GIF/WebP, verifica la firma binaria y limpia el nombre ([`server/services/uploadService.js`, líneas 5–19 y 26–38](server/services/uploadService.js#L5)).
3. Los binarios procesados se guardan en `UPLOAD_DIR` con un ID generado; el nombre original no se utiliza como ruta de almacenamiento ([líneas 22–41](server/services/uploadService.js#L22)).
4. `GET /api/uploads/:id` entrega la imagen con su tipo MIME y encabezados de seguridad; `DELETE /api/uploads/:id` permite borrar una carga propia que todavía no se haya adjuntado ([`server/server.js`, líneas 30–44](server/server.js#L30)).
5. `resolveAttachments` comprueba propietario, duplicados, cantidad y disponibilidad antes de permitir que un mensaje use las imágenes ([`uploadService.js`, líneas 43–55](server/services/uploadService.js#L43)).

#### 5.4.3 Hilos de ejecución y paralelismo en Node.js

1. El hilo principal de Node recibe HTTP y WebSocket. Las imágenes válidas se envían a `ImageProcessingService` desde la carga ([`server/services/uploadService.js`, líneas 26–38](server/services/uploadService.js#L26)).
2. `server/services/imageProcessingService.js` administra un pool acotado de uno o dos `Worker`, una cola máxima de 20 trabajos pendientes, la asignación de tareas y su cierre ([líneas 1–72](server/services/imageProcessingService.js#L1)). El pool se inicia cuando llega el primer trabajo.
3. `server/workers/imageWorker.js` usa `sharp` dentro del hilo de trabajo. Puede rotar según metadatos, reducir el lado mayor a 1920 píxeles y comprimir JPEG, PNG y WebP ([líneas 1–25](server/workers/imageWorker.js#L1)).
4. GIF se conserva sin transformación para no quitar fotogramas de animaciones. Si el resultado procesado no es menor, se conserva el original.
5. El binario se transfiere al worker y el resultado vuelve al servicio. El trabajo de CPU ocurre fuera del event loop principal y puede ejecutarse en paralelo en otros núcleos disponibles.
6. El pool tiene un límite para evitar aceptar una cola ilimitada. Al cerrar el servidor, se terminan los workers ordenadamente ([`server/server.js`, líneas 73–83](server/server.js#L73)).

Este paralelismo se usa en compresión y redimensionamiento, que consumen CPU. No se usa para repartir las operaciones normales de WebSocket o el acceso asíncrono al disco. `worker_threads` es una API nativa de Node.js; `sharp` es la librería que decodifica y codifica los formatos de imagen.

### 5.5 Videollamadas grupales

#### 5.5.1 Crear y unirse a una llamada

1. El botón de llamada grupal emite `call:start`; el banner de llamada activa permite a las demás personas unirse ([`public/js/features/callFeature.js`, líneas 5–37 y 45–91](public/js/features/callFeature.js#L5)).
2. `server/socket/callHandler.js` adapta los eventos entrantes al servicio de llamadas ([líneas 1–39](server/socket/callHandler.js#L1)).
3. `server/services/callService.js` mantiene las salas y participantes en mapas en memoria, asigna el ID de llamada, anuncia disponibilidad, gestiona ingreso/salida y limpia la llamada cuando queda vacía ([líneas 8–127](server/services/callService.js#L8)).
4. El servidor deriva la identidad del emisor a partir del WebSocket registrado. La señalización solo se entrega a participantes de la misma llamada.

#### 5.5.2 Intercambio de audio y video

1. `public/js/webrtc.js` obtiene cámara y micrófono con `getUserMedia`, crea una `RTCPeerConnection` por participante y usa los servidores ICE configurados ([líneas 1–65](public/js/webrtc.js#L1)).
2. Los participantes intercambian `webrtc:offer`, `webrtc:answer` y `webrtc:ice-candidate` a través del WebSocket. El servicio valida el tipo y longitud SDP ([`callService.js`, líneas 91–112](server/services/callService.js#L91)).
3. Los candidatos ICE recibidos antes de establecer la descripción remota se encolan y se aplican posteriormente ([`webrtc.js`, líneas 77–108](public/js/webrtc.js#L77)).
4. `CallFeature` actualiza mosaicos, estado, controles de cámara/micrófono, participantes y duración ([`callFeature.js`, líneas 92–286](public/js/features/callFeature.js#L92)).
5. Al terminar, `VideoCall` detiene las pistas y cierra conexiones WebRTC sin desconectar el chat ([`webrtc.js`, líneas 109–150](public/js/webrtc.js#L109)).

El cliente configura un servidor STUN público en [`public/js/webrtc.js`, línea 1](public/js/webrtc.js#L1). STUN no garantiza conexión en todas las redes. Para redes restrictivas se necesita configurar TURN con credenciales propias; no se incluyen credenciales en el repositorio.

### 5.6 Búsqueda, interfaz y diseño adaptable

- La búsqueda filtra los mensajes cargados localmente desde `ChatFeature` y su renderizado; no consulta un índice externo.
- `public/js/ui.js` centraliza renderizado de mensajes, avatares, usuarios, mensajes fijados, indicadores y notificaciones ([líneas 31–246](public/js/ui.js#L31)).
- `public/css/style.css` contiene estilos de la sala, barra lateral, mensajes, diálogos, cola de adjuntos, estados de carga y llamada.
- `public/assets/chat-pattern.svg` aporta la textura gráfica del área de conversación.
- `public/index.html` define los puntos de montaje del chat, de la videollamada y de los diálogos.

## 6. Mapa de archivos y referencias

Las rutas y líneas siguientes corresponden al código incluido en este repositorio. Los enlaces abren cada archivo en su sección.

### 6.1 Backend

| Archivo | Implementación |
| --- | --- |
| [`server/server.js`](server/server.js) | Composición Express/HTTP/WebSocket, rutas de adjuntos, `/health`, archivos estáticos y cierre del servidor. |
| [`server/socket/connectionHandler.js`](server/socket/connectionHandler.js#L7) | Conexiones WebSocket, parseo, broadcast, heartbeat y enrutamiento. |
| [`server/socket/userHandler.js`](server/socket/userHandler.js#L3) | Ingreso, sincronización de sala y presencia. |
| [`server/socket/messageHandler.js`](server/socket/messageHandler.js#L3) | Eventos de mensajes, reacciones, fijado, borrado, edición y escritura. |
| [`server/socket/callHandler.js`](server/socket/callHandler.js#L14) | Traducción de eventos WebSocket de llamada a comandos del servicio. |
| [`server/services/userService.js`](server/services/userService.js#L4) | Usuarios conectados e identidad por socket. |
| [`server/services/chatService.js`](server/services/chatService.js#L4) | Historial y reglas de mensajes en memoria. |
| [`server/services/callService.js`](server/services/callService.js#L8) | Estado de llamadas grupales, participantes y señalización privada. |
| [`server/services/uploadService.js`](server/services/uploadService.js#L5) | Validación, propiedad, límites y almacenamiento de adjuntos. |
| [`server/services/imageProcessingService.js`](server/services/imageProcessingService.js#L8) | Pool acotado de workers, cola de procesamiento y cierre. |
| [`server/workers/imageWorker.js`](server/workers/imageWorker.js#L1) | Compresión y redimensionamiento de imágenes mediante `sharp`. |
| [`server/services/messageRateLimiter.js`](server/services/messageRateLimiter.js#L1) | Límite de frecuencia de mensajes. |
| [`server/utils/events.js`](server/utils/events.js#L1) | Nombres de eventos, límites de protocolo y validadores de frames/texto. |

### 6.2 Frontend

| Archivo | Implementación |
| --- | --- |
| [`public/index.html`](public/index.html#L33) | Estructura del chat, controles, modal de adjuntos y vista de llamada. |
| [`public/js/app.js`](public/js/app.js#L9) | Composición de transporte y features. |
| [`public/js/socket.js`](public/js/socket.js#L1) | Cliente WebSocket, envío de eventos y reconexión. |
| [`public/js/features/sessionFeature.js`](public/js/features/sessionFeature.js#L4) | Ingreso, restauración de identidad y salida. |
| [`public/js/features/rosterFeature.js`](public/js/features/rosterFeature.js#L4) | Lista y estado de usuarios. |
| [`public/js/features/presenceFeature.js`](public/js/features/presenceFeature.js#L4) | Estado de transporte y presencia. |
| [`public/js/features/chatFeature.js`](public/js/features/chatFeature.js#L4) | Chat, acciones de mensajes, adjuntos, búsqueda e indicador de escritura. |
| [`public/js/features/callFeature.js`](public/js/features/callFeature.js#L5) | UI y coordinación de llamada grupal. |
| [`public/js/webrtc.js`](public/js/webrtc.js#L1) | `getUserMedia`, `RTCPeerConnection`, ICE y limpieza de medios. |
| [`public/js/ui.js`](public/js/ui.js#L31) | Funciones de presentación DOM compartidas. |
| [`public/css/style.css`](public/css/style.css) | Estilos de toda la interfaz. |
| [`public/assets/chat-pattern.svg`](public/assets/chat-pattern.svg) | Fondo decorativo de la sala. |

### 6.3 Configuración y documentación

| Archivo | Función |
| --- | --- |
| [`package.json`](package.json) | Dependencias y comandos `start`, `dev` y `test`. |
| [`README.md`](README.md) | Instalación, arquitectura, recorrido funcional y preguntas técnicas. |
| `.gitignore` | Excluye dependencias, archivos locales, cargas y artefactos de desarrollo. |

## 7. Contratos de comunicación

### 7.1 API HTTP

| Método y ruta | Propósito | Resultado |
| --- | --- | --- |
| `GET /health` | Consultar disponibilidad del proceso. | JSON con `status: "ok"`. |
| `POST /api/uploads?name=...` | Subir una imagen en el cuerpo binario. Requiere `Content-Type` y `X-Chat-User-Id`. | `201` con `attachment`: `id`, `name`, `type`, `size` y `url`. |
| `GET /api/uploads/:id` | Obtener una imagen ya cargada. | Binario con tipo MIME correspondiente. |
| `DELETE /api/uploads/:id` | Borrar una carga propia aún no asociada a mensaje. | `204` sin cuerpo. |

### 7.2 Eventos WebSocket principales

| Evento | Dirección | Uso |
| --- | --- | --- |
| `user:join` / `chat:sync` | Cliente → servidor / servidor → cliente | Registrar sesión y sincronizar personas e historial en memoria. |
| `message:new`, `message:edit`, `message:delete` | Ambos sentidos | Crear, editar y eliminar mensajes. |
| `reaction:toggle`, `message:pin` | Ambos sentidos | Cambiar reacción o fijado compartido. |
| `typing:start`, `typing:stop` | Ambos sentidos | Mostrar quién está escribiendo. |
| `call:start`, `call:join`, `call:end` | Cliente → servidor | Iniciar, unirse o salir de una llamada grupal. |
| `webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate` | Cliente ↔ servidor ↔ participante | Señalización privada para establecer cada conexión WebRTC. |
| `error` | Servidor → cliente | Informar errores de protocolo o de operación. |

Los nombres oficiales de los eventos están en [`server/utils/events.js`](server/utils/events.js#L15). Los binarios de imagen viajan por HTTP, no dentro de un frame WebSocket.

## 8. Pruebas y comprobación manual

Ejecuta la suite automatizada existente con:

```powershell
npm test
```

Para revisar la aplicación manualmente:

1. Inicia el servidor y abre `http://localhost:3000` en dos navegadores.
2. Ingresa con nombres diferentes y comprueba presencia, mensajes, reacciones, respuestas y fijado.
3. Adjunta imágenes JPEG, PNG, GIF y WebP; confirma que el modal se muestra antes del selector, se ve el progreso y las imágenes se publican.
4. Inicia una llamada grupal, únete desde el otro navegador y comprueba audio, video, controles y salida.
5. En una red con HTTPS, repite la llamada entre dispositivos. `getUserMedia` puede bloquearse en orígenes HTTP que no sean `localhost`.
6. Para revisar el worker, sube una imagen JPEG/PNG/WebP grande y observa que la carga se completa y que el tamaño informado corresponde al resultado guardado. GIF debe conservar su animación.

La ejecución de la suite y la validación física de cámaras, micrófonos, redes ICE/TURN y dispositivos dependen del entorno donde se evalúe el proyecto. No se deben presentar comprobaciones manuales como ejecutadas si no se realizaron.

## 9. Acceso entre dispositivos, ICE y Docker

### 9.1 Túnel HTTPS

1. Ejecuta el servidor en el equipo anfitrión.
2. Expón el puerto local `3000` mediante un túnel HTTPS disponible en el laboratorio, por ejemplo VS Code Port Forwarding, ngrok o Cloudflare Tunnel.
3. Abre la URL HTTPS del túnel en ambos dispositivos. El cliente elige `wss:` automáticamente cuando la página usa HTTPS.
4. Autoriza cámara y micrófono y prueba la llamada. El repositorio no contiene URL, tokens ni credenciales del túnel.

### 9.2 ICE, STUN y TURN

El cliente declara STUN en `public/js/webrtc.js`, línea 1. STUN ayuda a descubrir rutas de conexión; no transporta los medios y no garantiza conectividad entre todas las redes. Si la conexión directa falla, configura un servidor TURN autorizado y protege sus credenciales fuera del repositorio. Las URL ICE que se anuncian a cada navegador deben configurarse en el cliente WebRTC.

### 9.3 Persistencia en Docker

Se puede montar un volumen Docker para persistir los binarios, por ejemplo `chat-uploads:/app/data/uploads`, junto con `UPLOAD_DIR=/app/data/uploads`. Esto no persiste el historial de mensajes ni el mapa de propietarios de adjuntos: esos datos se mantienen en memoria y se pierden al reiniciar el proceso.

## 10. Límites y decisiones de diseño

1. Usuarios, presencia, llamadas, mensajes y metadatos de adjuntos viven en memoria; no hay login con cuentas ni base de datos.
2. Los binarios sí se escriben en disco; la ruta se configura con `UPLOAD_DIR`.
3. El tamaño máximo es 5 MB por imagen y se permiten hasta cinco imágenes por mensaje.
4. El pool de imágenes usa como máximo dos workers y mantiene hasta 20 trabajos pendientes. Los GIF se dejan intactos; JPEG, PNG y WebP se redimensionan a un máximo de 1920 píxeles y se recomprimen cuando el resultado es menor.
5. WebRTC conecta cada pareja de participantes de la llamada. El servidor solo coordina salas y retransmite señalización; no actúa como SFU ni retransmite audio/video.
6. STUN público no sustituye un servidor TURN para redes que bloquean conexiones directas.
7. Lucide se descarga desde un CDN, por lo que los iconos dependen de que ese recurso esté accesible.

## 11. Preguntas técnicas y respuestas

### 11.1 ¿Node.js ejecuta el servidor en varios hilos?

El código normal de Node se ejecuta principalmente en el hilo del event loop. En esta app se usan explícitamente `worker_threads` para el procesamiento de imágenes: pool en `server/services/imageProcessingService.js` y tarea de imagen en `server/workers/imageWorker.js`. Así se desplaza trabajo de CPU fuera del hilo que atiende HTTP y WebSocket.

### 11.2 ¿Qué parte de la aplicación se ejecuta en paralelo?

La optimización de imágenes JPEG, PNG y WebP. El pool puede ejecutar hasta dos workers al mismo tiempo, dependiendo de los núcleos disponibles. La cola limita los trabajos pendientes para controlar el consumo de recursos.

### 11.3 ¿Por qué no se crea un hilo por cada mensaje o conexión?

Mensajes y conexiones WebSocket suelen esperar I/O y se atienden bien mediante el event loop. Un worker añade coste de creación, memoria y comunicación. Se reserva para la transformación de imágenes, que sí puede consumir CPU.

### 11.4 ¿Qué diferencia hay entre WebSocket y WebRTC en este proyecto?

WebSocket transmite mensajes, presencia y señalización de llamadas. WebRTC lleva audio y video entre navegadores. El servidor no reenvía el contenido multimedia.

### 11.5 ¿Cómo sabe el servidor quién envía un evento de llamada?

El servidor obtiene el usuario a partir del WebSocket ya registrado en `UserService`. No confía en un identificador de emisor suministrado libremente por el cliente. `CallService` verifica que ambos extremos pertenezcan a la misma llamada antes de reenviar la señalización.

### 11.6 ¿Dónde quedan guardados mensajes e imágenes?

Los mensajes y metadatos de adjuntos permanecen en memoria. Los binarios de imagen se guardan en `UPLOAD_DIR`, que por defecto es `.chat-uploads`. Por eso un reinicio conserva archivos en disco, pero no restaura el historial ni sus referencias.

### 11.7 ¿Por qué se valida la firma de la imagen además del MIME?

El `Content-Type` y la extensión son valores declarados por el cliente y pueden falsificarse. La firma inicial del binario ayuda a comprobar que el contenido corresponde al formato permitido.

### 11.8 ¿Por qué los GIF no se recomprimen con `sharp`?

Una transformación estándar puede procesar solo un fotograma y eliminar la animación. El worker deja GIF sin modificar para mantener todos sus fotogramas.

### 11.9 ¿Qué hace STUN y cuándo se necesita TURN?

STUN ayuda a que los navegadores descubran direcciones/rutas para intentar una conexión directa. TURN retransmite el tráfico cuando la conexión directa no es posible. Algunas redes requieren TURN; por eso STUN solo no garantiza conectividad universal.

### 11.10 ¿Qué ocurre al apagar cámara o micrófono?

El cliente cambia el estado de la pista multimedia local y notifica ese estado al participante remoto. La conexión WebRTC puede permanecer activa. Al salir o finalizar, `VideoCall.cleanup()` detiene las pistas y cierra las conexiones.

### 11.11 ¿Cómo se controla que solo exista un mensaje fijado?

`ChatService.togglePin()` quita el estado fijado del mensaje anterior antes de fijar otro y emite ambas actualizaciones a la sala. Así todos los clientes muestran el mismo mensaje fijado.

### 11.12 ¿Qué falta para que el historial sobreviva a un reinicio?

Hace falta incorporar almacenamiento persistente para usuarios, mensajes y metadatos de adjuntos, además de definir autenticación y políticas de acceso. El almacenamiento actual de imágenes por sí solo no conserva las referencias en memoria.
