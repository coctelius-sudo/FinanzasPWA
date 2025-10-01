
# Finanzas PWA (ready-to-deploy)

Proyecto PWA de finanzas personales (mobile-first, tema oscuro).
Incluye:
- Registro y edición de movimientos (ingresos/gastos).
- Reconciliación automática de saldos por cuenta.
- Categorías y cuentas editables.
- Recordatorios básicos (local).
- Gráficas (Chart.js).
- Export CSV y Excel (SheetJS).
- Backups automáticos guardados en localStorage, descarga y restauración.
- Manifest y Service Worker para PWA instalable y offline.

## Deploy rápido en GitHub Pages
1. Crear un repo (ej: `finanzas-pwa`).
2. Subir todo el contenido de esta carpeta al root de la rama `main`.
3. En GitHub → Settings → Pages → Source: `main` / `root`.
4. Esperar unos segundos y abrir `https://tu-usuario.github.io/finanzas-pwa/`.

## Versionado / Cache
- Si actualizas archivos, incrementa `CACHE_VERSION` en `service-worker.js` y añade `?v=x` en referencias en `index.html` a `app.js` y `style.css`.

