import type { LngLatBoundsLike } from "maplibre-gl";

export type BoundaryLevel = 0 | 1 | 2;

export const countryBounds: Record<string, LngLatBoundsLike> = {
  co: [[-78.9953, -4.2242], [-66.8696, 12.4413]],
  mx: [[-118.4077, 14.5321], [-86.7104, 32.7187]],
  ar: [[-73.5312, -54.8441], [-53.6013, -21.8056]],
  es: [[-18.1605, 27.6378], [4.3278, 43.7914]],
  us: [[-125, 24], [-66, 50]],
};

export function boundaryLevel(zoom: number): BoundaryLevel {
  return zoom >= 8.5 ? 2 : zoom >= 5.5 ? 1 : 0;
}

const levelNames: Record<string, [string, string, string]> = {
  co: ["País", "Departamentos", "Municipios"],
  mx: ["País", "Estados", "Municipios"],
  ar: ["País", "Provincias", "Partidos / departamentos"],
  es: ["País", "Comunidades autónomas", "Municipios"],
  us: ["País", "Estados", "Condados"],
};

export function boundaryLevelName(countryId: string, level: BoundaryLevel): string {
  return (levelNames[countryId] ?? levelNames.co)[level];
}

export function boundaryUrl(countryId: string, level: BoundaryLevel): string {
  const file = level === 0 ? "adm0" : level === 1 ? "adm1" : "local";
  return "/boundaries/" + countryId + "/" + file + ".geojson";
}


