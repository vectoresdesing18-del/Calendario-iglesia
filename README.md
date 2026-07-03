# Planificación Litúrgica V7.0

Sistema ministerial para GitHub Pages.

## Incluye

- Login con Google mediante Firebase Auth.
- Firestore por usuario.
- Sincronización entre PC y celular.
- Dashboard premium.
- Calendario mensual.
- Generador automático de reuniones por horarios configurables.
- Reuniones completas.
- Equipo editable y eliminable.
- Invitados editables y eliminables.
- Series bíblicas editables y eliminables.
- Estadísticas simples por predicador.
- Google Calendar con recordatorios.
- Backup JSON.
- PWA básica instalable.

## Archivos

```txt
index.html
css/style.css
js/app.js
js/firebase.js
js/calendar.js
manifest.webmanifest
sw.js
assets/icon.svg
firestore.rules
README.md
```

## Subir a GitHub Pages

1. Borra el contenido anterior del repositorio.
2. Sube el contenido de este ZIP, no el ZIP completo.
3. Ve a Settings > Pages.
4. Source: Deploy from a branch.
5. Branch: main.
6. Folder: / root.
7. Abre la app con:

```txt
?v=v7-release
```

## Firebase

Ya está configurado para:

```txt
calendario-iglesia-4517e
```

## Reglas Firestore

En Firebase > Firestore Database > Reglas, pega el contenido de:

```txt
firestore.rules
```

## Google Calendar

El archivo `js/calendar.js` incluye el Client ID que ya estabas usando:

```txt
636584219049-doqeu47pcle33b3o7p005s2d1mb1u3a9.apps.googleusercontent.com
```

En Google Cloud debe estar autorizado este origen:

```txt
https://vectoresdesing18-del.github.io
```

Para conectar Google Calendar, usa Google Chrome.


## Nueva función
- Descarga de imagen mensual estilo WhatsApp desde Dashboard y Calendario.


## V7.1.1
Corrección de caché para que aparezca el botón "Descargar imagen".
Después de subir, abrir con:

https://vectoresdesing18-del.github.io/Calendario-iglesia/?v=7-1-1
