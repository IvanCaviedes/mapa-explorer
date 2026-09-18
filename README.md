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

- **Tiendas:** cada cadena tiene un color distinto en los puntos y en el listado. Hay tres cadenas y 900 puntos por país, excepto Estados Unidos, que tiene 18 cadenas y 11.760 puntos. Las ubicaciones son de demostración; no representan sucursales verificadas. Cada punto conserva su celda H3 de resolución 7; las tiendas se agrupan en hexágonos de resolución 5, 6 o 7 según el zoom. El color de cada H3 indica cuántas cadenas visibles tienen puntos en esa celda: 1, 2–3, 4–7 u 8 o más. Al pulsar un H3 se muestran el total de puntos y el desglose por cadena. Al pulsar un punto se muestra el nombre de ejemplo y una dirección ficticia, creada solo para probar la interfaz. Los enlaces del listado llevan a los sitios oficiales de las cadenas.
- **Movilidad:** cada tienda de ejemplo tiene una serie horaria de 24 cantidades simuladas de personas cercanas. Solo desde zoom 11 se dibuja un halo centrado en cada tienda; al alejarse no se muestra calor. El color del halo indica entre 20 y 220 personas simuladas por hora y el control horario actualiza la vista sin recargar los datos. La comparación horaria usa halos rojos y azules para aumentos y disminuciones. Son cantidades ficticias, no mediciones de visitantes reales.

El catálogo de cadenas, tiendas y movilidad está en app/map-data.ts. Cada tienda conserva un índice H3 válido. intensityByHour contiene 24 intensidades normalizadas y passersbyByHour contiene 24 cantidades simuladas por tienda. **Estos datos son ficticios y no representan personas observadas ni trayectorias reales**; los límites territoriales sí provienen de geoBoundaries.

El mapa base de OpenFreeMap usa datos de OpenStreetMap y necesita conexión a internet.
La vista se mantiene plana: se ocultan los edificios, el relieve y únicamente el relleno de colegios del estilo base; también se desactivan la inclinación y la rotación. Las demás capas de uso del suelo permanecen visibles bajo las celdas H3 semitransparentes.
Las capas del mapa base, los límites territoriales y el radio de análisis se dibujan debajo de H3. Encima van los halos de actividad y, en primer plano, los puntos de tienda con borde blanco.



En Estados Unidos se incluyen Walmart, Target y Costco, más 15 cadenas adicionales que pueden mostrarse u ocultarse individualmente en 49 ciudades de ejemplo. Las coordenadas de referencia de las ciudades añadidas provienen del [Gazetteer de lugares del Censo de EE. UU. (2025)](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html); San Francisco usa un punto céntrico urbano para esta visualización. El encuadre inicial muestra los 48 estados contiguos; Alaska, Hawái y los territorios permanecen disponibles al desplazar el mapa. Los puntos y direcciones son ficticios, no ubicaciones verificadas.

## Explorar la demo

- Filtra cadenas desde las casillas del listado. Los puntos, H3, calor e indicadores se actualizan juntos.
- Busca una tienda o ciudad del país seleccionado para acercar el mapa; una tienda abre su ficha.
- Usa **Restablecer vista** para recuperar el encuadre del país y poner el giro y la inclinación en cero.
- Reproduce el horario a 1x, 2x o 4x, o mueve el control manualmente.
- Compara la hora actual con una hora de referencia: naranja muestra aumento simulado y azul disminución. El resumen presenta el cambio medio por ciudad.
- Los indicadores son tiendas filtradas, celdas H3 ocupadas e índice relativo de actividad. No representan visitas reales.

## Análisis de tienda

Al seleccionar un punto o una tienda desde la búsqueda, la ficha muestra una curva de actividad simulada para las 24 horas. El marcador sigue el control horario. El radio de 1, 3 o 5 km se dibuja sobre el mapa y la lista muestra hasta cuatro tiendas filtradas cercanas, ordenadas por distancia aproximada. Todos estos puntos y perfiles son ficticios.

La presentación usa el logotipo publicado en el sitio oficial de MiQ y una paleta inspirada en su identidad visual. Los colores de las cadenas se mantienen distintos para leer el mapa.
