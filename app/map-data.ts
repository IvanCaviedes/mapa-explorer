import { cellToParent, latLngToCell } from "h3-js";

export type City = { name: string; region: string; coordinates: [number, number] };
export type StoreBrand = {
  id: string;
  name: string;
  color: [number, number, number];
  sourceUrl: string;
};
export type Store = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  address: string;
  description: string;
  color: [number, number, number];
  city: string;
  region: string;
  coordinates: [number, number];
  hex: string;
};
export type StoreHex = { hex: string; count: number; brandCounts: Record<string, number>; color: [number, number, number] };
export type MobilitySample = {
  storeId: string;
  brandId: string;
  city: string;
  coordinates: [number, number];
  intensityByHour: number[];
};
export type CountryDefinition = {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  brands: StoreBrand[];
  cities: City[];
  stores: Store[];
  mobility: MobilitySample[];
};
type CitySeed = [string, string, number, number];
export function aggregateStores(stores: Store[], brands: StoreBrand[], resolution: number): StoreHex[] {
  const cells = new Map<string, StoreHex>();
  for (const store of stores) {
    const hex = cellToParent(store.hex, resolution);
    const cell = cells.get(hex) ?? { hex, count: 0, brandCounts: {}, color: store.color };
    cell.count++;
    cell.brandCounts[store.brandId] = (cell.brandCounts[store.brandId] ?? 0) + 1;
    const leader = brands.reduce((best, brand) =>
      (cell.brandCounts[brand.id] ?? 0) > (cell.brandCounts[best.id] ?? 0) ? brand : best, brands[0]);
    cell.color = leader.color;
    cells.set(hex, cell);
  }
  return [...cells.values()];
}

function sampleStore(city: City, cityIndex: number, brandIndex: number, index: number): [number, number] {
  // Distribución reproducible en un radio de unos 9 km alrededor de la ciudad.
  const seed = (cityIndex + 1) * 101 + (brandIndex + 1) * 149 + (index + 1) * 521;
  const angle = ((seed * 0.61803398875) % 1) * Math.PI * 2;
  const radiusKm = 0.5 + Math.sqrt(((seed * 0.754877666) % 1)) * 8.5;
  const latitude = city.coordinates[1] + Math.sin(angle) * radiusKm / 111;
  const longitude = city.coordinates[0] + Math.cos(angle) * radiusKm / (111 * Math.cos(city.coordinates[1] * Math.PI / 180));
  return [longitude, latitude];
}


function buildCountry(
  id: string,
  name: string,
  center: [number, number],
  zoom: number,
  brands: StoreBrand[],
  seeds: CitySeed[],
): CountryDefinition {
  const cities = seeds.map(([cityName, region, longitude, latitude]) => ({
    name: cityName, region, coordinates: [longitude, latitude] as [number, number],
  }));
  const stores = cities.flatMap((city, cityIndex) => brands.flatMap((brand, brandIndex) =>
    Array.from({ length: 30 }, (_, index) => {
      const [longitude, latitude] = sampleStore(city, cityIndex, brandIndex, index);
      return {
        id: id + "-" + cityIndex + "-" + brand.id + "-" + index,
        brandId: brand.id,
        brandName: brand.name,
        name: brand.name + " " + city.name + " " + String(index + 1).padStart(2, "0"),
        address: (id === "us" ? "Sample St " : "Calle ") + (100 + (index * 7 + brandIndex * 11) % 300) + " #" +
          (10 + (index * 13 + cityIndex * 5) % 90) + "-" + (10 + (index * 3 + brandIndex * 17) % 90) +
          ", " + city.name + ", " + city.region,
        description: "Sucursal de demostración de " + brand.name + " en " + city.name +
          ". Punto ficticio para explorar la distribución de tiendas y su celda H3.",
        color: brand.color,
        city: city.name,
        region: city.region,
        coordinates: [longitude, latitude] as [number, number],
        hex: latLngToCell(latitude, longitude, 7),
      };
    })
  ));
  const mobility = stores
    .flatMap((store, index) => Array.from({ length: 1 }, (_, sampleIndex) => {
      const angle = ((index * 0.61803398875 + sampleIndex / 3) % 1) * Math.PI * 2;
      const distanceKm = 0.15 + sampleIndex * 0.28;
      const latitude = store.coordinates[1] + Math.sin(angle) * distanceKm / 111;
      const longitude = store.coordinates[0] + Math.cos(angle) * distanceKm /
        (111 * Math.cos(store.coordinates[1] * Math.PI / 180));
      const intensityByHour = Array.from({ length: 24 }, (_, hour) => {
        const variation = (index % 7) - 3;
        const morning = Math.exp(-Math.pow((hour - 8 - variation * 0.2) / 2.4, 2));
        const midday = Math.exp(-Math.pow((hour - 13) / 3.4, 2));
        const evening = Math.exp(-Math.pow((hour - 18 + variation * 0.2) / 2.8, 2));
        const localFactor = 0.65 + ((index * 17 + sampleIndex * 11) % 31) / 50;
        return Math.min(1, Number(((0.035 + morning * 0.38 + midday * 0.5 +
          evening * 0.72) * localFactor).toFixed(3)));
      });
      return {
        storeId: store.id,
        brandId: store.brandId,
        city: store.city,
        coordinates: [longitude, latitude] as [number, number],
        intensityByHour,
      };
    }));
  return { id, name, center, zoom, brands, cities, stores, mobility };
}

// Las cadenas son reales; estas coordenadas son ilustrativas, no sucursales verificadas.
export const countries: CountryDefinition[] = [
  buildCountry("co", "Colombia", [-74.1, 4.7], 5, [
    { id: "exito", name: "Éxito", color: [234, 172, 37], sourceUrl: "https://www.grupoexito.com.co/es/negocios-marcas" },
    { id: "d1", name: "D1", color: [197, 52, 66], sourceUrl: "https://4mbient3q4.tiendasd1.com/tiendas" },
    { id: "carulla", name: "Carulla", color: [38, 137, 94], sourceUrl: "https://www.grupoexito.com.co/es/negocios-marcas" },
  ], [
    ["Bogotá", "Bogotá D. C.", -74.0721, 4.711], ["Medellín", "Antioquia", -75.5812, 6.2442],
    ["Cali", "Valle del Cauca", -76.532, 3.4516], ["Barranquilla", "Atlántico", -74.7813, 10.9685],
    ["Cartagena", "Bolívar", -75.4794, 10.391], ["Bucaramanga", "Santander", -73.1227, 7.1193],
    ["Pereira", "Risaralda", -75.6906, 4.8133], ["Cúcuta", "Norte de Santander", -72.5078, 7.8939],
    ["Ibagué", "Tolima", -75.2322, 4.4389], ["Villavicencio", "Meta", -73.6266, 4.142],
  ]),
  buildCountry("mx", "México", [-101.5, 23.5], 4.3, [
    { id: "walmart", name: "Walmart", color: [45, 104, 194], sourceUrl: "https://www.walmartmexico.com/conocenos/directorio-de-tiendas" },
    { id: "aurrera", name: "Bodega Aurrerá", color: [223, 109, 50], sourceUrl: "https://www.walmartmexico.com/conocenos/directorio-de-tiendas" },
    { id: "soriana", name: "Soriana", color: [36, 146, 107], sourceUrl: "https://www.organizacionsoriana.com/acerca_de_nosotros.html" },
  ], [
    ["Ciudad de México", "Ciudad de México", -99.1332, 19.4326], ["Guadalajara", "Jalisco", -103.3496, 20.6597],
    ["Monterrey", "Nuevo León", -100.3161, 25.6866], ["Puebla", "Puebla", -98.2063, 19.0414],
    ["Tijuana", "Baja California", -117.0382, 32.5149], ["León", "Guanajuato", -101.684, 21.122],
    ["Querétaro", "Querétaro", -100.3899, 20.5888], ["Mérida", "Yucatán", -89.5926, 20.9674],
    ["Toluca", "Estado de México", -99.6557, 19.2826], ["Cancún", "Quintana Roo", -86.8515, 21.1619],
  ]),
  buildCountry("ar", "Argentina", [-63.7, -35.7], 4.2, [
    { id: "coto", name: "Coto", color: [198, 61, 74], sourceUrl: "https://www.coto.com.ar/sucursales/" },
    { id: "carrefour", name: "Carrefour", color: [46, 100, 189], sourceUrl: "https://www.carrefour.com.ar/" },
    { id: "dia", name: "Día", color: [171, 63, 128], sourceUrl: "https://diaonline.supermercadosdia.com.ar/tiendas" },
  ], [
    ["Buenos Aires", "Ciudad Autónoma de Buenos Aires", -58.3816, -34.6037], ["Córdoba", "Córdoba", -64.1888, -31.4201],
    ["Rosario", "Santa Fe", -60.6393, -32.9442], ["Mendoza", "Mendoza", -68.8458, -32.8895],
    ["La Plata", "Buenos Aires", -57.9545, -34.9215], ["Mar del Plata", "Buenos Aires", -57.5575, -38.0055],
    ["Salta", "Salta", -65.4232, -24.7821], ["San Miguel de Tucumán", "Tucumán", -65.2176, -26.8083],
    ["Santa Fe", "Santa Fe", -60.7087, -31.6333], ["Neuquén", "Neuquén", -68.0591, -38.9516],
  ]),
  buildCountry("us", "Estados Unidos", [-98.5, 39.5], 3.8, [
    { id: "walmart-us", name: "Walmart", color: [35, 105, 202], sourceUrl: "https://www.walmart.com/store-finder" },
    { id: "target", name: "Target", color: [205, 47, 60], sourceUrl: "https://www.target.com/store-locator/store-directory" },
    { id: "costco", name: "Costco", color: [31, 139, 112], sourceUrl: "https://www.costco.com/warehouse/locator.aspx" },
  ], [
    ["Nueva York", "Nueva York", -74.0060, 40.7128], ["Los Ángeles", "California", -118.2437, 34.0522],
    ["Chicago", "Illinois", -87.6298, 41.8781], ["Houston", "Texas", -95.3698, 29.7604],
    ["Phoenix", "Arizona", -112.0740, 33.4484], ["Filadelfia", "Pensilvania", -75.1652, 39.9526],
    ["San Antonio", "Texas", -98.4936, 29.4241], ["San Diego", "California", -117.1611, 32.7157],
    ["Dallas", "Texas", -96.7970, 32.7767], ["Miami", "Florida", -80.1918, 25.7617],
    ["Seattle", "Washington", -122.3321, 47.6062], ["Atlanta", "Georgia", -84.3880, 33.7490],
    ["Boston", "Massachusetts", -71.018253, 42.338551],
    ["Washington D. C.", "Distrito de Columbia", -77.016524, 38.904243],
    ["San Francisco", "California", -122.4194, 37.7749],
    ["San Jose", "California", -121.814552, 37.296011],
    ["Sacramento", "California", -121.468161, 38.567694],
    ["Las Vegas", "Nevada", -115.264037, 36.233499],
    ["Portland", "Oregon", -122.649971, 45.536951],
    ["Salt Lake City", "Utah", -111.930991, 40.776928],
    ["Denver", "Colorado", -104.881105, 39.76185],
    ["Colorado Springs", "Colorado", -104.760749, 38.867255],
    ["Albuquerque", "Nuevo México", -106.646809, 35.10478],
    ["Tucson", "Arizona", -110.870773, 32.153036],
    ["El Paso", "Texas", -106.431106, 31.84778],
    ["Austin", "Texas", -97.754134, 30.298622],
    ["Fort Worth", "Texas", -97.348573, 32.781954],
    ["Jacksonville", "Florida", -81.661603, 30.336864],
    ["Orlando", "Florida", -81.320242, 28.472818],
    ["Tampa", "Florida", -82.479673, 27.970086],
    ["New Orleans", "Luisiana", -89.934502, 30.05342],
    ["Birmingham", "Alabama", -86.797036, 33.527174],
    ["Memphis", "Tennessee", -89.968511, 35.109164],
    ["Charlotte", "Carolina del Norte", -80.83099, 35.209045],
    ["Raleigh", "Carolina del Norte", -78.641042, 35.831868],
    ["Baltimore", "Maryland", -76.610476, 39.300032],
    ["Pittsburgh", "Pensilvania", -79.975676, 40.439936],
    ["Cleveland", "Ohio", -81.679435, 41.478462],
    ["Columbus", "Ohio", -82.985594, 39.985531],
    ["Detroit", "Míchigan", -83.102237, 42.383037],
    ["Minneapolis", "Minnesota", -93.26832, 44.963324],
    ["Kansas City", "Misuri", -94.550313, 39.125155],
    ["St. Louis", "Misuri", -90.244582, 38.635699],
    ["Milwaukee", "Wisconsin", -87.966695, 43.063348],
    ["Omaha", "Nebraska", -96.053475, 41.262705],
    ["Oklahoma City", "Oklahoma", -97.513657, 35.467079],
    ["Louisville", "Kentucky", -85.740614, 38.224728],
    ["Buffalo", "Nueva York", -78.859686, 42.892492],
    ["Richmond", "Virginia", -77.476009, 37.531399],
  ]),
  buildCountry("es", "España", [-4.5, 40.1], 5.2, [
    { id: "mercadona", name: "Mercadona", color: [39, 139, 87], sourceUrl: "https://www.mercadona.es/" },
    { id: "carrefour", name: "Carrefour", color: [43, 97, 188], sourceUrl: "https://www.carrefour.es/tiendas-carrefour/buscador-de-tiendas/" },
    { id: "lidl", name: "Lidl", color: [229, 171, 40], sourceUrl: "https://tiendas.lidl.es/" },
  ], [
    ["Madrid", "Comunidad de Madrid", -3.7038, 40.4168], ["Barcelona", "Cataluña", 2.1734, 41.3851],
    ["Valencia", "Comunitat Valenciana", -0.3763, 39.4699], ["Sevilla", "Andalucía", -5.9845, 37.3891],
    ["Zaragoza", "Aragón", -0.8891, 41.6488], ["Málaga", "Andalucía", -4.4214, 36.7213],
    ["Murcia", "Región de Murcia", -1.1307, 37.9922], ["Bilbao", "País Vasco", -2.9349, 43.263],
    ["Valladolid", "Castilla y León", -4.7286, 41.6523], ["Alicante", "Comunitat Valenciana", -0.481, 38.3452],
  ]),
];



