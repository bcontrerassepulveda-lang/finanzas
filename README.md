# Mi Portal Financiero

Aplicacion financiera local para registrar ingresos, egresos, tarjetas, socios, objetivos, importaciones y proyecciones mensuales.

## Abrir localmente

Usa un servidor local y abre:

```text
http://localhost:4173/index.html
```

Para Firebase Auth con Google, usa `localhost` en vez de `127.0.0.1`, o agrega `127.0.0.1` como dominio autorizado en Firebase Authentication.

## Archivos principales

- `index.html`: entrada de la aplicacion.
- `app.js`: logica financiera, importador, vistas y autenticacion.
- `styles.css`: estilos visuales.
- `firebase-config.js`: configuracion web de Firebase.
- `xlsx.full.min.js`: lectura local de archivos Excel.
- `modelo-excel-finanzas.xlsx`: plantilla para importar cartolas.

## Privacidad

Los datos financieros se guardan localmente en el navegador. Exporta respaldos periodicos y evita usar computadores compartidos.

## IA con Groq

La app no guarda la API key de Groq en el frontend. Para usar la IA desde GitHub Pages, despliega la funcion Firebase incluida en `functions/`.

```bash
firebase login
firebase use vamoaver
firebase functions:config:set groq.key="TU_API_KEY_GROQ"
firebase deploy --only functions:groq
```

La app llama al proxy configurado en `groq-config.js`.
