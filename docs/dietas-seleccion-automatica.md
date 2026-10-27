# Preselección de dietas al cerrar jornada

La pantalla mostraba modo Auto pero no conectaba lugar de fin y base con los selectores de ruta y pernocta. Ahora propone Nacional/Internacional según país, pernocta según distancia a la base (o ciudad y país cuando no hay coordenadas), y 100% fuera de base. Usa también país de inicio e información de países ya registrada para no convertir un regreso internacional en nacional.

Caso Abrera → Alicante, España: Nacional, Pernocta Sí, 100%. Regreso a Abrera: Pernocta No; no se impone un porcentaje de llegada. Una corrección manual tiene prioridad; pulsar Auto permite recuperar la propuesta. Sin ubicación o base reconocibles no se inventa una selección. El GPS se vincula al texto resuelto para no aplicarlo a otro destino escrito manualmente.

Se aplica al formulario normal con pago por dietas y modo Auto, sin alterar modos especiales de Marruecos ni recalcular jornadas históricas. Pernocta es una propuesta editable: la ubicación no demuestra por sí sola dónde dormirá el conductor. Los importes siguen utilizando las tarifas configuradas.

Validación: 85 pruebas y TypeScript, incluidas ocho pruebas nuevas de Alicante/Abrera, radio de base, internacional, campos manuales, información ausente y GPS obsoleto. Pendiente validación visual en dispositivo real y nueva compilación instalada.
