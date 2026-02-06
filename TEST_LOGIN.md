# Test de Login con Verificación Gmail

Este documento explica cómo usar el script de prueba para verificar la funcionalidad de login con verificación Gmail.

## Requisitos Previos

1. **Configuración YAML completa**: Asegúrate de que el archivo `config/ezcater_web_establishment_bot.yaml` tenga:
   - Sección `accounts` con al menos una cuenta (usuario y contraseña)
   - Sección `gmail` con la configuración de Gmail y selectores

2. **Gmail configurado**: El navegador debe tener una sesión activa de Gmail o poder iniciar sesión automáticamente.

3. **Selectores correctos**: Los selectores CSS en el YAML deben coincidir con los elementos de tu página web.

## Ejecutar el Test

### Opción 1: Usando yarn script (Recomendado)

```bash
yarn test:login
```

### Opción 2: Usando tsx directamente

```bash
yarn tsx src/test-login.ts
```

### Opción 3: Compilar y ejecutar

```bash
yarn build
node dist/test-login.js
```

## Qué Hace el Test

El script de prueba ejecuta los siguientes pasos:

1. **Carga la configuración** desde el archivo YAML
2. **Inicializa el navegador** con un perfil de prueba
3. **Verifica el estado de login** actual
4. **Intenta hacer login** con las cuentas configuradas:
   - Ingresa usuario y contraseña
   - Detecta si se requiere código de verificación
   - Si es necesario, busca el código en Gmail
   - Ingresa el código de verificación
5. **Verifica el resultado** del login
6. **Mantiene el navegador abierto** por 30 segundos para inspección manual

## Configuración de Ejemplo

Asegúrate de tener esta configuración en `config/ezcater_web_establishment_bot.yaml`:

```yaml
accounts:
  - username: "tu-usuario@ejemplo.com"
    password: "tu-contraseña"

gmail:
  email: "tu-gmail@gmail.com"
  subject: "Your verification code"
  codePattern: "\\b\\d{6}\\b"
  loginSelector: "#username"
  passwordSelector: "#password"
  codeInputSelector: "#verification-code"
  loginButtonSelector: "button[type='submit']"
  loggedInIndicator: ".user-menu"
  codeWaitTimeout: 30000
  maxCodeRetries: 3
```

## Interpretación de Resultados

### Test Exitoso

```
=== TEST RESULT: SUCCESS ===
✓ Login flow completed successfully
✓ Login verification: User is logged in
```

Esto significa que:
- El login se completó correctamente
- El código de verificación se obtuvo de Gmail (si fue necesario)
- El usuario está autenticado

### Test Fallido

```
=== TEST RESULT: FAILED ===
✗ Login failed with all configured accounts
```

Posibles causas:
- Credenciales incorrectas
- Selectores CSS no coinciden con la página
- Gmail no está accesible o no tiene el correo de verificación
- La página requiere pasos adicionales de autenticación

### Usuario Ya Logueado

```
Test completed: User is already authenticated
```

Si el usuario ya está logueado, el test se detiene. Para probar el flujo completo:
1. Cierra sesión manualmente en el navegador
2. Ejecuta el test nuevamente

## Solución de Problemas

### Error: "No accounts configured"

**Solución**: Agrega la sección `accounts` al archivo YAML con al menos una cuenta.

### Error: "Gmail configuration not found"

**Solución**: Agrega la sección `gmail` al archivo YAML con la configuración necesaria.

### Error: "Username input not found"

**Solución**: Verifica que el selector `loginSelector` en el YAML coincida con el input de usuario en tu página. Puedes usar las herramientas de desarrollador del navegador para encontrar el selector correcto.

### Error: "Could not retrieve verification code from Gmail"

**Solución**: 
- Verifica que Gmail esté accesible y tengas sesión iniciada
- Asegúrate de que el asunto del correo (`subject`) coincida exactamente
- Verifica que el correo de verificación haya llegado antes de ejecutar el test
- Aumenta `codeWaitTimeout` si el correo tarda en llegar

### El navegador no se cierra automáticamente

**Solución**: El navegador se cierra automáticamente después de 30 segundos. Si necesitas cerrarlo antes, puedes hacerlo manualmente. Si el test detecta que ya estás logueado, presiona cualquier tecla para cerrar.

## Notas Importantes

1. **Perfil de prueba**: El test usa un perfil de navegador separado en `browsers/test_profile/` para no interferir con el bot principal.

2. **Navegador visible**: El test ejecuta el navegador en modo visible (no headless) para que puedas ver qué está pasando.

3. **Tiempo de espera**: El test espera 30 segundos antes de cerrar el navegador para que puedas inspeccionar manualmente el resultado.

4. **Múltiples cuentas**: Si tienes varias cuentas configuradas, el test intentará con cada una hasta que una tenga éxito.

## Próximos Pasos

Después de que el test sea exitoso:

1. Verifica que los selectores funcionen correctamente en tu página real
2. Ajusta los timeouts si es necesario
3. Configura el patrón de código (`codePattern`) si tu código tiene un formato diferente
4. Ejecuta el bot principal con `yarn start` o `yarn dev`
