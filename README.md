# Chatea — Sala general

Chat grupal en navegador con comunicación bidireccional mediante WebSocket nativo, servidor Node.js y una interfaz responsiva de tonos suaves.

## Requisitos e instalación

- Node.js 24 (se recomienda la versión 24 indicada para la práctica).
- npm incluido con Node.js.
- Docker no es necesario.

Desde PowerShell, en la carpeta del proyecto:

```powershell
npm ci
npm start
```

Abre <http://localhost:3000>. Para desarrollo con recarga automática ejecuta `npm run dev`. El puerto se puede cambiar antes de iniciar: `$env:PORT=3001; npm start`. La comprobación HTTP está en `/health`; WebSocket usa `/ws` en el mismo host y puerto.

## Pruebas

```powershell
npm test
```

Las pruebas automatizadas abren cuatro clientes WebSocket y verifican sincronización de usuarios, broadcast, hora e identidad del mensaje, edición y eliminación autorizadas, rechazo de permisos ajenos, reacción, respuesta, fijado, escritura, presencia, JSON malformado, salida y reingreso con la misma identidad. También se consulta `/health`.

## Uso en varias ventanas

Abre <http://localhost:3000> en cuatro pestañas o ventanas y entra con nombres distintos. Cada pestaña guarda el nombre en `sessionStorage` y crea su propio identificador; conserva ese identificador durante las reconexiones mientras siga abierta. Envía mensajes, reacciona, responde o edita desde el autor. El botón del perfil alterna presencia entre En línea y Ausente. Para buscar, usa la lupa: la búsqueda cubre el historial recibido en esta sesión y se actualiza tras editar o eliminar mensajes.

Para observar reconexión, deja el servidor en una terminal, deténlo con Ctrl+C y observa el indicador de las ventanas. Vuelve a iniciar con `npm start`; cada cliente reintentará con espera progresiva (máximo 10 s), se identificará de nuevo y recibirá la lista de usuarios y el historial disponible. Como el historial es volátil, un reinicio comienza con historial vacío.

## Acceso desde un teléfono mediante túnel

El túnel debe reenviar tráfico HTTPS y WebSocket al puerto 3000. Por ejemplo, con ngrok instalado y autenticado, ejecuta `ngrok http 3000`, abre la URL HTTPS pública en el teléfono y en la computadora, y entra desde ambos. El cliente cambia automáticamente de `ws:` a `wss:` cuando la página usa HTTPS. También se puede usar VS Code Port Forwarding o Cloudflare Tunnel. No compartas tokens ni la URL si el túnel expone el chat públicamente. Esta verificación requiere un dispositivo externo y se considera pendiente hasta ejecutarla manualmente.

## Protocolo y comportamiento

Los frames son objetos JSON con forma `{ "type": "message:new", "requestId": "opcional", "payload": {} }`. El contrato está definido en `server/utils/events.js`. Entre los eventos están `user:join`, `user:leave`, `users:list`, `chat:sync`, `message:new`, `message:edit`, `message:delete`, `message:reply`, `message:pin`, `reaction:toggle`, `typing:start`, `typing:stop`, `presence:update` y `error`.

El servidor determina autoría mediante la conexión asociada a la identidad; ignora autores declarados por el cliente. Solo el autor puede editar, eliminar o fijar sus mensajes. La lista activa y presencia se reconstruyen con conexiones actuales. Los últimos 200 mensajes se mantienen en memoria y desaparecen al reiniciar el servidor. Los mensajes se validan hasta 2000 caracteres, los nombres hasta 24 y cada frame hasta 8 KiB. La interfaz inserta texto de usuarios con `textContent`, sin interpretar HTML.

## Estructura

- `server/server.js`: Express, salud, servidor HTTP y endpoint WebSocket.
- `server/utils/events.js`: nombres de eventos, límites y validadores.
- `server/services/`: estado en memoria de usuarios y chat.
- `server/socket/`: conexión, heartbeat y despacho de eventos.
- `public/js/socket.js`: WebSocket, estados y reconexión.
- `public/js/app.js`: estado de interfaz y acciones.
- `public/js/ui.js`: renderizado seguro y accesible.
- `tests/websocket.test.js`: verificación automatizada multiusuario.
- `PRUEBAS_MANUALES.md`: pasos y espacios para observaciones.
- `RUBRICA_VERIFICACION.md`: matriz de evidencias técnicas.

El diseño no carga bibliotecas, fuentes ni iconos externos; puede ejecutarse en una LAN sin CDN. No incluye autenticación ni persistencia de base de datos: esta es una sala de práctica accesible para quienes conocen la URL. El servidor debe estar expuesto solo a una red de confianza o mediante un túnel temporal.
