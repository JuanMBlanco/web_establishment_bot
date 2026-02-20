# Guía de Setup - Google Drive Integration

Esta guía te ayudará a configurar la integración con Google Drive para subir logs y reportes automáticamente desde el bot de ezCater.

## 📋 Requisitos Previos

1. Una cuenta de Google (Gmail)
2. Acceso a Google Cloud Console
3. Node.js instalado en tu proyecto
4. Google Workspace (para crear Shared Drive)

---

## 🔧 Paso 1: Crear Proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Si no tienes un proyecto, crea uno nuevo:
   - Click en el selector de proyectos (arriba a la izquierda)
   - Click en "Nuevo Proyecto"
   - Ingresa un nombre (ej: "ezcater-establishment-bot")
   - Click en "Crear"

---

## 🔌 Paso 2: Habilitar Google Drive API

1. En el menú lateral, ve a **APIs & Services** > **Library**
2. Busca "Google Drive API"
3. Click en "Google Drive API"
4. Click en **"Enable"** (Habilitar)

---

## 👤 Paso 3: Crear Service Account

1. En el menú lateral, ve a **APIs & Services** > **Credentials**
2. Click en **"+ CREATE CREDENTIALS"** (arriba)
3. Selecciona **"Service Account"**
4. Completa el formulario:
   - **Service account name**: `ezcater-drive-uploader` (o el nombre que prefieras)
   - **Service account ID**: Se genera automáticamente
   - **Description**: "Service account for uploading logs and reports to Google Drive"
5. Click en **"CREATE AND CONTINUE"**
6. En "Grant this service account access to project":
   - **Role**: Selecciona **"Editor"** (o "Owner" si prefieres más permisos)
   - Click en **"CONTINUE"**
7. Click en **"DONE"** (puedes saltar el paso de usuarios)

---

## 🔑 Paso 4: Generar y Descargar Credenciales JSON

1. En la lista de Service Accounts, encuentra el que acabas de crear
2. Click en el email del Service Account
3. Ve a la pestaña **"KEYS"**
4. Click en **"ADD KEY"** > **"Create new key"**
5. Selecciona **"JSON"**
6. Click en **"CREATE"**
7. Se descargará automáticamente un archivo JSON (ej: `ezcater-drive-uploader-xxxxx.json`)
8. **IMPORTANTE**: Guarda este archivo en un lugar seguro. **NO lo subas a Git** (ya está en .gitignore)

---

## 📁 Paso 5: Crear Shared Drive y Compartirlo

**⚠️ IMPORTANTE**: Los Service Accounts no tienen cuota de almacenamiento. Debes usar un **Shared Drive** (Google Workspace) en lugar de una carpeta personal.

1. Ve a [Google Drive](https://drive.google.com/)
2. En el menú lateral izquierdo, busca **"Shared drives"** (Unidades compartidas)
3. Si no tienes uno, crea un nuevo Shared Drive:
   - Click en **"New"** (Nuevo) > **"Shared drive"**
   - Ingresa un nombre (ej: `ezcater_establishment_logs`)
   - Click en **"Create"** (Crear)
4. Abre el Shared Drive que acabas de crear
5. Click en el nombre del Shared Drive (arriba) > **"Manage members"** (Administrar miembros)
6. Click en **"Add members"** (Agregar miembros)
7. Ingresa el **email del Service Account** (lo encuentras en el JSON descargado, campo `client_email`)
   - Ejemplo: `ezcater-drive-uploader@tu-proyecto.iam.gserviceaccount.com`
8. Dale el rol **"Content Manager"** o **"Manager"**
9. Click en **"Send"** (Enviar)
10. **Obtén el ID del Shared Drive**:
    - Abre el Shared Drive en Google Drive
    - Mira la URL: `https://drive.google.com/drive/folders/XXXXXXXXXXXXX`
    - El ID es la parte `XXXXXXXXXXXXX` después de `/folders/`
    - **Copia este ID**, lo necesitarás para la configuración

---

## ⚙️ Paso 6: Configurar el Proyecto

### 6.1. Instalar el paquete

El paquete `googleapis` ya está incluido en `package.json`. Si necesitas instalarlo manualmente:

```bash
yarn install
```

### 6.2. Colocar el archivo JSON de credenciales

1. Crea una carpeta `credentials` en la raíz del proyecto (si no existe)
2. Mueve el archivo JSON descargado a `credentials/google-drive-credentials.json`
   - O usa otro nombre, pero actualiza la configuración

### 6.3. Actualizar el archivo de configuración

Edita `config/ezcater_web_establishment_bot.yaml` y actualiza la sección `googleDrive`:

```yaml
googleDrive:
  # Ruta al archivo JSON de credenciales del Service Account
  credentialsPath: "./credentials/google-drive-credentials.json"
  # ID del Shared Drive en Google Drive donde se subirán los logs y reportes
  # ⚠️ IMPORTANTE: Debe ser un Shared Drive ID, no una carpeta personal
  folderId: "TU_SHARED_DRIVE_ID_AQUI"  # Reemplaza con tu ID
  # Habilitar/deshabilitar la subida automática
  enabled: true  # Cambia a true para habilitar
  # Frecuencia de subida (en horas). 0 = después de cada ejecución
  uploadIntervalHours: 0
  # Estructura de carpetas en Google Drive
  folderStructure:
    logs: "logs"  # Carpeta para logs del bot
    reports: "reports"  # Carpeta para reportes unificados
  # Organizar reportes por fecha en Google Drive (crea subcarpetas por fecha)
  organizeReportsByDate: true
```

---

## 🧪 Paso 7: Verificar la Configuración

1. Asegúrate de que el archivo JSON esté en la ruta correcta
2. Verifica que el `folderId` sea el ID de un **Shared Drive** (no una carpeta personal)
3. Verifica que el Service Account tenga acceso al Shared Drive con rol "Content Manager" o "Manager"
4. Ejecuta el bot y verifica que no haya errores de autenticación

### ⚠️ Error Común: "Service Accounts do not have storage quota"

Si ves este error, significa que:
- Estás intentando usar una carpeta personal en lugar de un Shared Drive
- El Service Account no tiene acceso al Shared Drive
- El `folderId` no es un Shared Drive ID

**Solución**: Asegúrate de usar un Shared Drive y que el Service Account tenga acceso a él.

---

## 📝 Estructura de Carpetas en Google Drive

Después de la primera subida, tu Google Drive tendrá esta estructura:

**Se suben:**
- ✅ `logs/` - Logs del bot (bot_YYYY-MM-DD.log)
- ✅ `reports/` - Reportes unificados en formato Markdown (.md) y texto plano (.txt) (organizados por fecha si está habilitado)

**Estructura con `organizeReportsByDate: true`:**
```
Shared Drive (folderId)/
├── logs/
│   └── bot_2026-01-15.log
└── reports/
    ├── 2026-01-15/
    │   ├── reporte_unificado_2026-01-15.md
    │   └── reporte_unificado_2026-01-15.txt
    └── 2026-01-16/
        ├── reporte_unificado_2026-01-16.md
        └── reporte_unificado_2026-01-16.txt
```

**Estructura con `organizeReportsByDate: false`:**
```
Shared Drive (folderId)/
├── logs/
│   └── bot_2026-01-15.log
└── reports/
    ├── reporte_unificado_2026-01-15.md
    ├── reporte_unificado_2026-01-15.txt
    ├── reporte_unificado_2026-01-16.md
    └── reporte_unificado_2026-01-16.txt
```

---

## 🔒 Seguridad

### ⚠️ IMPORTANTE - No subir credenciales a Git

El archivo JSON de credenciales contiene información sensible. Asegúrate de:

1. **Agregar a .gitignore** (ya está incluido):
   ```
   credentials/
   *.json
   !package.json
   !tsconfig.json
   ```

2. **No compartir el archivo JSON** públicamente

3. **Si se compromete**, revoca las credenciales inmediatamente:
   - Ve a Google Cloud Console > APIs & Services > Credentials
   - Encuentra el Service Account
   - Elimina la clave comprometida y crea una nueva

---

## 🚀 Uso

Una vez configurado, la subida a Google Drive se ejecuta automáticamente después de cada ejecución de `test-integrated.ts`:

```bash
yarn test:integrated
```

O con parámetros:

```bash
yarn test:integrated --date=2026-02-03 --accounts=account1,account2
```

La subida ocurre después de:
1. Procesar todas las cuentas
2. Generar el reporte unificado
3. Guardar el reporte localmente

---

## ❓ Troubleshooting

### Error: "The file does not exist"
- Verifica que la ruta al archivo JSON sea correcta
- Asegúrate de que el archivo existe y tiene permisos de lectura

### Error: "Permission denied" o "Insufficient permissions"
- Verifica que el Service Account tenga permisos de "Content Manager" o "Manager" en el Shared Drive
- Asegúrate de haber compartido el Shared Drive con el email del Service Account

### Error: "API not enabled"
- Verifica que la Google Drive API esté habilitada en Google Cloud Console

### Los logs/reportes no se suben
- Verifica que `googleDrive.enabled` sea `true` en la configuración
- Revisa los logs de la aplicación para ver errores específicos
- Verifica que los archivos existan localmente antes de la subida

### Error: "Service Accounts do not have storage quota"
- Asegúrate de usar un **Shared Drive** (no una carpeta personal)
- Verifica que el `folderId` sea el ID de un Shared Drive
- Confirma que el Service Account tenga acceso al Shared Drive

---

## 📞 Soporte

Si tienes problemas, revisa:
1. Los logs de la aplicación
2. La consola de Google Cloud para errores de API
3. Los permisos del Shared Drive en Google Drive
4. Que el archivo JSON de credenciales sea válido

---

## 🔐 Configuración de Domain-Wide Delegation para Gmail API (Opcional)

Si quieres usar la API de Gmail en lugar de Puppeteer para obtener códigos de verificación (más rápido y confiable), necesitas configurar Domain-Wide Delegation:

### Paso 1: Habilitar Gmail API

1. En Google Cloud Console, ve a **APIs & Services** > **Library**
2. Busca "Gmail API"
3. Click en "Gmail API"
4. Click en **"Enable"** (Habilitar)

### Paso 2: Configurar Domain-Wide Delegation

1. En Google Cloud Console, ve a **APIs & Services** > **Credentials**
2. Encuentra tu Service Account y click en él
3. Ve a la pestaña **"Advanced settings"** o busca **"Domain-wide delegation"**
4. Click en **"Enable Google Workspace Domain-wide Delegation"**
5. Anota el **Client ID** del Service Account (lo necesitarás en el siguiente paso)

### Paso 3: Configurar en Google Workspace Admin Console

1. Ve a [Google Workspace Admin Console](https://admin.google.com/)
2. Ve a **Security** > **API Controls** > **Domain-wide Delegation**
3. Click en **"Add new"**
4. Ingresa el **Client ID** del Service Account
5. En **OAuth Scopes**, ingresa:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```
6. Click en **"Authorize"**

### Paso 4: Configurar en el proyecto

Edita `config/ezcater_web_establishment_bot.yaml`:

```yaml
googleDrive:
  # ... otras configuraciones ...
  gmailUserEmail: "web.team@weknock.com"  # Email del usuario de Gmail
  useGmailAPI: true  # Usar API de Gmail en lugar de Puppeteer
```

### Beneficios de usar Gmail API

- ✅ **Más rápido**: No necesita abrir el navegador
- ✅ **Más confiable**: No depende de cambios en la interfaz de Gmail
- ✅ **Soporte de labels**: Puede buscar emails usando labels de Gmail
- ✅ **Mejor rendimiento**: Menor uso de recursos

### Búsqueda por Labels

La API de Gmail puede buscar emails usando labels. Cada cuenta puede tener un `gmailLabel` configurado:

```yaml
accounts:
  - username: "carrot.orders@weknock.com"
    password: "mrweknock2022"
    gmailLabel: "EZ cater Carrot"  # Buscará emails con este label
```

Cuando se usa `useGmailAPI: true`, la función buscará automáticamente emails con el label especificado para cada cuenta.

---

## 📚 Referencias

- [Google Drive API Documentation](https://developers.google.com/drive/api/v3/about-sdk)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Service Accounts Documentation](https://cloud.google.com/iam/docs/service-accounts)
- [Domain-Wide Delegation Documentation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)
- [Shared Drives Documentation](https://support.google.com/a/answer/7212025)
