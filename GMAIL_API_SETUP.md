# 🔐 Guía de Configuración - Gmail API con Domain-Wide Delegation

Esta guía te ayudará a configurar Domain-Wide Delegation para usar la API de Gmail con Service Account.

## ⚠️ Error Común

Si ves este error:
```
unauthorized_client: Client is unauthorized to retrieve access tokens using this method, 
or client not authorized for any of the scopes requested.
```

Significa que **Domain-Wide Delegation no está configurado correctamente**.

---

## 📋 Requisitos Previos

1. ✅ Service Account creado (ya lo tienes: `establishment-web@cobalt-ripsaw-437023-s6.iam.gserviceaccount.com`)
2. ✅ Credenciales JSON descargadas (ya las tienes en `credentials/google-drive-credentials.json`)
3. ✅ Gmail API habilitada en Google Cloud Console
4. ✅ Acceso a Google Workspace Admin Console (requiere permisos de administrador)

---

## 🔧 Paso 1: Habilitar Gmail API

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona tu proyecto: **cobalt-ripsaw-437023-s6**
3. Ve a **APIs & Services** > **Library**
4. Busca **"Gmail API"**
5. Click en **"Gmail API"**
6. Click en **"Enable"** (Habilitar)

---

## 🔑 Paso 2: Obtener Client ID del Service Account

1. En Google Cloud Console, ve a **APIs & Services** > **Credentials**
2. Busca tu Service Account: **establishment-web@cobalt-ripsaw-437023-s6.iam.gserviceaccount.com**
3. **Click en el email del Service Account** (no en las keys)
4. En la página de detalles, busca la sección **"Advanced settings"** o **"Domain-wide delegation"**
5. Si no está habilitado, click en **"Enable Google Workspace Domain-wide Delegation"**
6. **Copia el Client ID** (número largo, ejemplo: `113685895212703120365`)
   - Lo encontrarás en la sección "Domain-wide delegation" o en la parte superior de la página

---

## 🏢 Paso 3: Configurar en Google Workspace Admin Console

**⚠️ IMPORTANTE**: Necesitas permisos de administrador en Google Workspace.

1. Ve a [Google Workspace Admin Console](https://admin.google.com/)
2. Ve a **Security** > **API Controls** > **Domain-wide Delegation**
3. Click en **"Add new"** (Agregar nuevo)
4. Completa el formulario:
   - **Client ID**: Pega el Client ID que copiaste en el Paso 2
   - **OAuth Scopes**: Ingresa exactamente esto (una línea):
     ```
     https://www.googleapis.com/auth/gmail.readonly
     ```
5. Click en **"Authorize"** (Autorizar)

---

## ✅ Paso 4: Verificar Configuración

1. Verifica que el Client ID aparezca en la lista de "Domain-wide Delegation"
2. Verifica que el scope esté correcto: `https://www.googleapis.com/auth/gmail.readonly`
3. Verifica que el email del usuario en tu YAML sea correcto:
   ```yaml
   googleDrive:
     gmailUserEmail: "orders@weknock.com"  # Debe ser un email de tu dominio
   ```

---

## 🧪 Paso 5: Probar la Configuración

Ejecuta el script de prueba:

```bash
yarn test:gmail-api
```

### Resultado Esperado (Éxito):
```
✓ Gmail client initialized for user: orders@weknock.com
✓ SUCCESS: Verification code found: 123456
Gmail API integration is working correctly!
```

### Si Aún Ves Errores:

#### Error: "unauthorized_client"
- ✅ Verifica que Domain-Wide Delegation esté habilitado en el Service Account
- ✅ Verifica que el Client ID esté agregado en Google Workspace Admin Console
- ✅ Verifica que el scope sea exactamente: `https://www.googleapis.com/auth/gmail.readonly`
- ✅ Verifica que el email `orders@weknock.com` sea del mismo dominio de Google Workspace

#### Error: "Precondition check failed"
- ✅ Verifica que Gmail API esté habilitada en Google Cloud Console
- ✅ Verifica que el Service Account tenga permisos en el proyecto

#### Error: "No emails found"
- ✅ Verifica que existan emails con el subject: "MFA code for ezCater"
- ✅ Verifica que los emails vengan de "support"
- ✅ Verifica que el label (si se usa) exista en Gmail

---

## 📝 Checklist de Configuración

- [ ] Gmail API habilitada en Google Cloud Console
- [ ] Domain-Wide Delegation habilitado en el Service Account
- [ ] Client ID del Service Account copiado
- [ ] Client ID agregado en Google Workspace Admin Console
- [ ] Scope `https://www.googleapis.com/auth/gmail.readonly` agregado
- [ ] Email `orders@weknock.com` configurado en YAML
- [ ] Credenciales JSON en `credentials/google-drive-credentials.json`
- [ ] Script de prueba ejecutado: `yarn test:gmail-api`

---

## 🔍 Verificar Client ID

Si no encuentras el Client ID, puedes obtenerlo del archivo JSON de credenciales:

1. Abre `credentials/google-drive-credentials.json`
2. Busca el campo `client_id` (si existe)
3. O ve a Google Cloud Console > Service Account > Details

**Nota**: El Client ID es diferente del `client_email`. El Client ID es un número largo que se usa para Domain-Wide Delegation.

---

## 🆘 Troubleshooting Avanzado

### El Client ID no aparece en el Service Account

1. Ve a Google Cloud Console > APIs & Services > Credentials
2. Click en el Service Account
3. Si no ves "Domain-wide delegation", puede que necesites:
   - Habilitar Google Workspace API en el proyecto
   - O el Service Account fue creado sin Domain-Wide Delegation

### No tienes acceso a Google Workspace Admin Console

- Necesitas permisos de administrador en Google Workspace
- Contacta al administrador de tu organización para que configure Domain-Wide Delegation
- Proporciónale el Client ID y el scope necesario

### El email no es del dominio correcto

- El email en `gmailUserEmail` debe ser del mismo dominio de Google Workspace
- Si `orders@weknock.com` no es un email de Google Workspace, usa uno que sí lo sea
- O configura un email de Google Workspace que tenga acceso a los emails de verificación

---

## 📚 Referencias

- [Domain-Wide Delegation Documentation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Service Accounts Documentation](https://cloud.google.com/iam/docs/service-accounts)

---

## ✅ Una Vez Configurado

Después de configurar Domain-Wide Delegation correctamente:

1. Ejecuta `yarn test:gmail-api` para verificar
2. Si funciona, la API de Gmail se usará automáticamente en `test-integrated`
3. Puppeteer se usará como fallback si la API falla
