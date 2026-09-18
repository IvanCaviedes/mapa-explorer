import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sources = [];

const countries = [
  ["co", "COL", "ADM2"],
  ["mx", "MEX", "ADM2"],
  ["ar", "ARG", "ADM2"],
  ["es", "ESP", "ADM3"],
  ["us", "USA", "ADM2"],
];

for (const [id, iso, localLevel] of countries) {
  for (const [fileLevel, sourceLevel] of [["adm0", "ADM0"], ["adm1", "ADM1"], ["local", localLevel]]) {
    const metadataUrl = "https://www.geoboundaries.org/api/current/gbOpen/" + iso + "/" + sourceLevel + "/";
    const metadataResponse = await fetch(metadataUrl);
    if (!metadataResponse.ok) throw new Error(metadataUrl + ": " + metadataResponse.status);
    const metadata = await metadataResponse.json();
    const response = await fetch(metadata.simplifiedGeometryGeoJSON);
    if (!response.ok) throw new Error(metadata.simplifiedGeometryGeoJSON + ": " + response.status);
    const collection = await response.json();
    if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new Error("GeoJSON inválido: " + iso + " " + sourceLevel);
    }
    const features = collection.features.map((feature) => ({
      type: "Feature",
      properties: { name: feature.properties?.shapeName ?? feature.properties?.name ?? "Sin nombre" },
      geometry: feature.geometry,
    }));
    const destination = path.join("public", "boundaries", id);
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, fileLevel + ".geojson"), JSON.stringify({ type: "FeatureCollection", features }));
    sources.push({ country: id, level: sourceLevel, source: metadata.simplifiedGeometryGeoJSON, license: metadata.boundaryLicense, boundarySource: metadata.boundarySource, boundaryYear: metadata.boundaryYear });
    console.log(id, sourceLevel, features.length, metadata.boundaryLicense);
  }
}


await writeFile(path.join("public", "boundaries", "sources.json"), JSON.stringify(sources, null, 2));

