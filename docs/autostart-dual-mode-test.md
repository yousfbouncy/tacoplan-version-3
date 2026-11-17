# Tacoplan: pruebas de AutoStart de jornada y conducción

## Modos independientes

- **AutoStart de jornada:** interruptor en AutoStart. Sin una jornada abierta, toma muestras GPS durante aproximadamente 60 segundos cada 5 minutos **mientras la app está en primer plano**. Se detiene al comenzar una jornada. En segundo plano usa los eventos de bajo consumo que el sistema operativo permita; no se pueden garantizar ventanas exactas.
- **AutoStart de conducción:** interruptor en **Inicio → Actividades de la jornada**. Solo solicita posición mientras hay jornada iniciada. Detecta velocidad de al menos 15 km/h durante 3 minutos de muestras continuas y termina la conducción tras 1 minuto detenido. Las pausas automáticas no se registran como descanso, disponibilidad ni trabajo. Se detiene al cerrar la jornada. Con permiso «Mientras se usa» funciona en primer plano; el segundo plano requiere autorización adicional.
- Ambos interruptores mantienen preferencias separadas. No cambia los datos económicos ni sustituye los registros de tacógrafo.

## Prueba inicial en el ordenador

```bash
git checkout main
git pull --ff-only
npm ci
npm run typecheck
npm test
npx expo start --localhost
```

La pantalla web de localhost sirve para revisar los interruptores y los textos. **El navegador no simula la tarea nativa de ubicación en segundo plano**: para probarla utiliza una compilación Android/iOS y un teléfono con permisos.

## Generar una APK de pruebas con EAS

```bash
npx eas-cli build --platform android --profile preview
```

Requiere inicio de sesión en Expo, credenciales de construcción y acceso al proyecto. El perfil `preview` del repositorio está configurado para producir una APK. No instalar la APK encima de una instalación con datos importantes sin confirmar la estrategia de conservación de datos.

## Pruebas en un Android real

1. Dejar desactivados ambos interruptores. Comprobar que ninguna tarea AutoStart solicita GPS.
2. Activar **solo conducción** sin jornada: el GPS de conducción permanece parado.
3. Iniciar jornada manualmente. Con AutoStart conducción activo, observar 3 minutos de movimiento válido por encima de 15 km/h: se registra Conducción. Una parada de al menos 1 minuto cierra el tramo, sin inventar descanso. Cerrar jornada y comprobar que se detiene la tarea.
4. Activar **solo inicio de jornada** y dejar jornada cerrada: en primer plano, observar una ventana de ubicación de 1 minuto cada 5. El arranque puede necesitar varias ventanas porque no se realiza un seguimiento continuo.
5. Probar ambos activados: cuando se abre jornada, el GPS de AutoStart jornada debe detenerse y el de conducción puede activarse; al cerrarla ocurre lo contrario.
6. Repetir con pantalla bloqueada y permisos «Mientras se usa» y «Permitir siempre», anotando si Android entrega ubicaciones. No considerar garantizados los intervalos exactos en segundo plano.
7. Comprobar cierre de sesión, cambio de usuario, reinicio de app, uso sin red y permisos revocados.
8. Comparar consumo de batería y eventos perdidos durante recorridos reales, sin manipular el móvil al volante.

Las pruebas automáticas solo verifican la lógica y la compilación. El GPS y el consumo necesitan pruebas físicas.
