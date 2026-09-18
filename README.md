# MiQ | Explorador retail

Propuesta de demostración para MiQ: exploración de cobertura retail, zonas H3 y actividad horaria simulada con React, TypeScript, MapLibre GL y deck.gl. No es un producto oficial de MiQ ni usa datos de audiencia reales.

## Ejecutar

```bash
npm install
npm run dev
```

Abre http://localhost:5173.

## Vista territorial por zoom

Al abrir la demo, Estados Unidos aparece seleccionado y el mapa encuadra los 48 estados contiguos. Al cambiar de país, encuadra el territorio correspondiente. La capa **Límites territoriales** se puede apagar de forma independiente.

- Zoom menor de 5,5: contorno del país.
- Desde 5,5: límites de departamentos, estados, provincias o comunidades autónomas.
- Desde 8,5: divisiones locales. Son municipios en Colombia, México y España, y condados en Estados Unidos. Para Argentina, la fuente disponible llega a partidos y departamentos; no equivale siempre al perímetro urbano de una ciudad.

Los nombres de ciudades del mapa base aparecen al acercarse. No se usan puntos de capitales para representar países. Pulsa un polígono para ver su nombre. Los datos de las divisiones se cargan bajo demanda al llegar a cada escala.

Los contornos son versiones simplificadas de [geoBoundaries](https://www.geoboundaries.org/) y están incluidos en `public/boundaries`. Consulta `public/boundaries/sources.json` para la fuente y licencia de cada país y nivel. Para actualizarlos, ejecuta `node scripts/update-boundaries.mjs`.

## Otras capas

- **Tiendas:** tres cadenas reconocidas por país, cada una con un color distinto en el mapa y en el listado. Las cadenas son reales, pero los 900 puntos por país (4410 en Estados Unidos) son ubicaciones de demostración; no representan sucursales verificadas. Cada punto conserva su celda H3 de resolución 7; las tiendas se agrupan en hexágonos de resolución 5, 6 o 7 según el zoom. Al pulsar un punto se muestra el nombre de ejemplo y una dirección ficticia, creada solo para probar la interfaz. Los enlaces del listado llevan a sitios oficiales para consultar sucursales reales.
- **Movilidad:** mapa de calor continuo con MapLibre, generado a partir de puntos de actividad ficticia alrededor de tiendas de ejemplo. El control horario recorre 00:00-23:00 y cambia la intensidad por hora sin recargar los datos. Los H3 de tiendas permanecen visibles junto al calor; se vuelven semitransparentes para que ambas capas se puedan leer.

El catálogo de cadenas, tiendas y movilidad está en app/map-data.ts. Cada tienda conserva un índice H3 válido. intensityByHour contiene 24 intensidades normalizadas por hora para cada muestra de actividad. **Estos datos son ficticios y representan concentración, no trayectorias reales**; los límites territoriales sí provienen de geoBoundaries.

El mapa base de OpenFreeMap usa datos de OpenStreetMap y necesita conexión a internet.



En Estados Unidos se incluyen Walmart, Target y Costco en 49 ciudades de ejemplo. Las coordenadas de referencia de las ciudades añadidas provienen del [Gazetteer de lugares del Censo de EE. UU. (2025)](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html); San Francisco usa un punto céntrico urbano para esta visualización. El encuadre inicial muestra los 48 estados contiguos; Alaska, Hawái y los territorios permanecen disponibles al desplazar el mapa. Los puntos y direcciones son ficticios, no ubicaciones verificadas.

## Explorar la demo

- Filtra cadenas desde las casillas del listado. Los puntos, H3, calor e indicadores se actualizan juntos.
- Busca una tienda o ciudad del país seleccionado para acercar el mapa; una tienda abre su ficha.
- Reproduce el horario a 1x, 2x o 4x, o mueve el control manualmente.
- Compara la hora actual con una hora de referencia: naranja muestra aumento simulado y azul disminución. El resumen presenta el cambio medio por ciudad.
- Los indicadores son tiendas filtradas, celdas H3 ocupadas e índice relativo de actividad. No representan visitas reales.

## Análisis de tienda

Al seleccionar un punto o una tienda desde la búsqueda, la ficha muestra una curva de actividad simulada para las 24 horas. El marcador sigue el control horario. El radio de 1, 3 o 5 km se dibuja sobre el mapa y la lista muestra hasta cuatro tiendas filtradas cercanas, ordenadas por distancia aproximada. Todos estos puntos y perfiles son ficticios.

La presentación usa el logotipo publicado en el sitio oficial de MiQ y una paleta inspirada en su identidad visual. Los colores de las cadenas se mantienen distintos para leer el mapa.
