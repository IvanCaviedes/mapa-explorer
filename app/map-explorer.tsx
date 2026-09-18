"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { cellToParent } from "h3-js";
import { ScatterplotLayer } from "@deck.gl/layers";
import { aggregateStores, countries, type Store } from "./map-data";
import {
  boundaryLevel,
  boundaryLevelName,
  boundaryUrl,
  countryBounds,
  type BoundaryLevel,
} from "./boundary-data";
import "maplibre-gl/dist/maplibre-gl.css";

const mapStyle = "https://tiles.openfreemap.org/styles/liberty";
const defaultCountry = countries.find((item) => item.id === "us") ?? countries[0];
const emptyCollection = { type: "FeatureCollection" as const, features: [] };
const boundaryLayerIds = [
  "country-fill",
  "country-line",
  "region-fill",
  "region-line",
  "local-fill",
  "local-line",
];
type LayerId = "stores" | "territory" | "mobility";
type Selection = {
  title: string;
  detail: string;
  address?: string;
  description?: string;
  hex?: string;
  storeId?: string;
};
const layerMeta: {
  id: LayerId;
  name: string;
  description: string;
  color: string;
}[] = [
  { id: "stores", name: "Tiendas", description: "Ubicaciones de ejemplo y zonas H3", color: "#EA00AD" },
  { id: "territory", name: "Territorio", description: "País, regiones y divisiones locales", color: "#6A2876" },
  { id: "mobility", name: "Actividad", description: "Concentración simulada por hora", color: "#FF6500" },
];

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRadians = Math.PI / 180;
  const latitudeDelta = (b[1] - a[1]) * toRadians;
  const longitudeDelta = (b[0] - a[0]) * toRadians;
  const part = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a[1] * toRadians) * Math.cos(b[1] * toRadians) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(part), Math.sqrt(1 - part));
}

function radiusPolygon(center: [number, number], radiusKm: number) {
  const [longitude, latitude] = center;
  const coordinates = Array.from({ length: 65 }, (_, index) => {
    const angle = index / 64 * Math.PI * 2;
    return [
      longitude + Math.cos(angle) * radiusKm / (111.32 * Math.cos(latitude * Math.PI / 180)),
      latitude + Math.sin(angle) * radiusKm / 110.57,
    ];
  });
  coordinates[64] = coordinates[0];
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [coordinates] },
    }],
  };
}

function addBoundaryLayers(
  map: MapLibreMap,
  onSelect: (selection: Selection) => void,
  recentlySelectedOverlay: () => boolean,
) {
  for (const id of ["country", "region", "local"]) {
    map.addSource(id + "-boundaries", {
      type: "geojson",
      data: emptyCollection,
    });
  }
  map.addLayer({
    id: "country-fill",
    type: "fill",
    source: "country-boundaries",
    paint: { "fill-color": "#7b398b", "fill-opacity": 0.11 },
  });
  map.addLayer({
    id: "region-fill",
    type: "fill",
    source: "region-boundaries",
    minzoom: 5.5,
    paint: { "fill-color": "#9d66ab", "fill-opacity": 0.04 },
  });
  map.addLayer({
    id: "local-fill",
    type: "fill",
    source: "local-boundaries",
    minzoom: 8.5,
    paint: { "fill-color": "#ed5a9f", "fill-opacity": 0.025 },
  });
  map.addLayer({
    id: "local-line",
    type: "line",
    source: "local-boundaries",
    minzoom: 8.5,
    paint: { "line-color": "#cf2b86", "line-width": 2.2, "line-opacity": 1 },
  });
  map.addLayer({
    id: "region-line",
    type: "line",
    source: "region-boundaries",
    minzoom: 5.5,
    paint: { "line-color": "#8b3f99", "line-width": 2.3, "line-opacity": 1 },
  });
  map.addLayer({
    id: "country-line",
    type: "line",
    source: "country-boundaries",
    paint: { "line-color": "#4b1456", "line-width": 3.5, "line-opacity": 1 },
  });
  map.on("click", (event) => {
    if (recentlySelectedOverlay()) return;
    const features = map.queryRenderedFeatures(event.point, {
      layers: ["local-fill", "region-fill", "country-fill"],
    });
    const feature = ["local-fill", "region-fill", "country-fill"]
      .map((id) => features.find((item) => item.layer.id === id))
      .find(Boolean);
    if (!feature) return;
    const detail =
      feature.layer.id === "local-fill"
        ? "División local"
        : feature.layer.id === "region-fill"
          ? "Departamento / estado"
          : "País";
    onSelect({
      title: String(feature.properties?.name ?? "Sin nombre"),
      detail,
    });
  });
}
export default function MapExplorer() {
  const [countryId, setCountryId] = useState(defaultCountry.id);
  const [visible, setVisible] = useState<Record<LayerId, boolean>>({
    stores: true,
    territory: true,
    mobility: true,
  });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [radiusKm, setRadiusKm] = useState(3);
  const [hour, setHour] = useState(12);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hiddenBrands, setHiddenBrands] = useState<string[]>([]);
  const [comparison, setComparison] = useState(false);
  const [compareHour, setCompareHour] = useState(8);
  const [searchQuery, setSearchQuery] = useState("");
  const [level, setLevel] = useState<BoundaryLevel>(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const loadedRef = useRef({ country: "", region: "", local: "" });
  const countryFitRef = useRef(false);
  const hexClickRef = useRef(new Map<string, number>());
  const lastOverlayClickRef = useRef(0);
  const country =
    countries.find((item) => item.id === countryId) ?? defaultCountry;
  const filteredStores = useMemo(
    () => country.stores.filter((store) => !hiddenBrands.includes(store.brandId)),
    [country, hiddenBrands],
  );
  const filteredMobility = useMemo(
    () => country.mobility.filter((sample) => !hiddenBrands.includes(sample.brandId)),
    [country, hiddenBrands],
  );
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query.length < 2) return [];
    const cities = country.cities.filter((city) =>
      city.name.toLocaleLowerCase().includes(query)).slice(0, 3)
      .map((city) => ({ kind: "city" as const, label: city.name + ", " + city.region, city }));
    const stores = country.stores.filter((store) =>
      store.name.toLocaleLowerCase().includes(query) ||
      store.address.toLocaleLowerCase().includes(query)).slice(0, 6)
      .map((store) => ({ kind: "store" as const, label: store.name, store }));
    return [...cities, ...stores].slice(0, 8);
  }, [country, searchQuery]);
  const selectedStore = selected?.storeId
    ? country.stores.find((store) => store.id === selected.storeId)
    : undefined;
  const storeSamples = selectedStore
    ? country.mobility.filter((sample) => sample.storeId === selectedStore.id)
    : [];
  const storeProfile = Array.from({ length: 24 }, (_, index) =>
    storeSamples.length
      ? Math.round(storeSamples.reduce((sum, sample) => sum + sample.intensityByHour[index], 0) /
          storeSamples.length * 100)
      : 0);
  const nearbyStores = selectedStore
    ? filteredStores
        .filter((store) => store.id !== selectedStore.id)
        .map((store) => ({ store, km: distanceKm(selectedStore.coordinates, store.coordinates) }))
        .filter((item) => item.km <= radiusKm)
        .sort((a, b) => a.km - b.km)
    : [];
  const activityIndex = filteredMobility.length
    ? Math.round(filteredMobility.reduce((sum, sample) => sum + sample.intensityByHour[hour], 0) / filteredMobility.length * 100)
    : 0;
  const referenceIndex = filteredMobility.length
    ? Math.round(filteredMobility.reduce((sum, sample) => sum + sample.intensityByHour[compareHour], 0) / filteredMobility.length * 100)
    : 0;
  const cityChanges = useMemo(() => country.cities.map((city) => {
    const samples = filteredMobility.filter((sample) => sample.city === city.name);
    const current = samples.reduce((sum, sample) => sum + sample.intensityByHour[hour], 0);
    const reference = samples.reduce((sum, sample) => sum + sample.intensityByHour[compareHour], 0);
    return { name: city.name, change: samples.length ? Math.round((current - reference) / samples.length * 100) : 0 };
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3),
  [country, filteredMobility, hour, compareHour]);

  useEffect(() => {
    setHiddenBrands([]);
    setSearchQuery("");
    setPlaying(false);
  }, [countryId]);

  useEffect(() => {
    if (!visible.mobility) setPlaying(false);
  }, [visible.mobility]);

  useEffect(() => {
    if (!containerRef.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: defaultCountry.center,
      zoom: 3,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">geoBoundaries</a>',
      }),
      "bottom-left",
    );
    const overlay = new MapLibreOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);
    map.on("load", () => {
      addBoundaryLayers(
        map,
        setSelected,
        () => Date.now() - lastOverlayClickRef.current < 300,
      );
      map.addSource("mobility-heat", { type: "geojson", data: emptyCollection });
      map.addLayer({
        id: "mobility-heat",
        type: "heatmap",
        source: "mobility-heat",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["get", "h12"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 8, 1.2, 12, 1.6],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 18, 8, 30, 12, 48],
          "heatmap-opacity": 0.82,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(234, 0, 173, 0)",
            0.2, "rgba(234, 0, 173, 0.48)",
            0.45, "rgba(242, 66, 123, 0.72)",
            0.7, "rgba(255, 101, 0, 0.88)",
            1, "rgba(255, 161, 31, 1)"],
        },
      }, "local-line");
      map.addLayer({
        id: "mobility-gain",
        type: "heatmap",
        source: "mobility-heat",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": 0,
          "heatmap-intensity": 1.4,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 18, 8, 30, 12, 48],
          "heatmap-opacity": 0.82,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(255, 181, 100, 0)",
            0.3, "rgba(255, 181, 100, 0.65)",
            0.65, "rgba(235, 87, 58, 0.9)",
            1, "rgba(181, 40, 60, 1)"],
        },
      }, "local-line");
      map.addLayer({
        id: "mobility-loss",
        type: "heatmap",
        source: "mobility-heat",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": 0,
          "heatmap-intensity": 1.4,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 18, 8, 30, 12, 48],
          "heatmap-opacity": 0.72,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(117, 205, 229, 0)",
            0.3, "rgba(117, 205, 229, 0.6)",
            0.65, "rgba(62, 147, 199, 0.85)",
            1, "rgba(40, 91, 166, 1)"],
        },
      }, "local-line");
      map.addSource("store-radius", { type: "geojson", data: emptyCollection });
      map.addLayer({
        id: "store-radius-fill", type: "fill", source: "store-radius",
        paint: { "fill-color": "#df258f", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "store-radius-line", type: "line", source: "store-radius",
        paint: { "line-color": "#b82283", "line-width": 2, "line-dasharray": [2, 2] },
      });
      map.fitBounds(countryBounds[defaultCountry.id], {
        padding: 48,
        duration: 0,
        maxZoom: 5,
      });
      setLevel(boundaryLevel(map.getZoom()));
      setMapReady(true);
    });
    map.on("zoom", () =>
      setLevel((current) => {
        const next = boundaryLevel(map.getZoom());
        return current === next ? current : next;
      }),
    );
    map.on("error", (event) => {
      if (event.error?.message) setMapError(true);
    });
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    setSelected(null);
    setLevel(0);
    countryFitRef.current = true;
    map.once("moveend", () => {
      countryFitRef.current = false;
      setLevel(boundaryLevel(map.getZoom()));
    });
    map.fitBounds(countryBounds[country.id], {
      padding: map.getContainer().clientWidth < 700 ? 24 : 48,
      duration: 850,
      maxZoom: 5,
    });
  }, [country, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource("store-radius") as maplibregl.GeoJSONSource;
    source.setData(selectedStore ? radiusPolygon(selectedStore.coordinates, radiusKm) : emptyCollection);
  }, [selectedStore, radiusKm, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = (name: string) =>
      map.getSource(name + "-boundaries") as maplibregl.GeoJSONSource;
    if (loadedRef.current.country !== country.id) {
      source("country").setData(boundaryUrl(country.id, 0));
      source("region").setData(emptyCollection);
      source("local").setData(emptyCollection);
      loadedRef.current = { country: country.id, region: "", local: "" };
    }
    if (
      !countryFitRef.current &&
      level >= 1 &&
      loadedRef.current.region !== country.id
    ) {
      source("region").setData(boundaryUrl(country.id, 1));
      loadedRef.current.region = country.id;
    }
    if (
      !countryFitRef.current &&
      level >= 2 &&
      loadedRef.current.local !== country.id
    ) {
      source("local").setData(boundaryUrl(country.id, 2));
      loadedRef.current.local = country.id;
    }
  }, [country, level, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const id of boundaryLayerIds) {
      map.setLayoutProperty(
        id,
        "visibility",
        visible.territory ? "visible" : "none",
      );
    }
  }, [visible.territory, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource("mobility-heat") as maplibregl.GeoJSONSource;
    source.setData({
      type: "FeatureCollection",
      features: filteredMobility.map((sample) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: sample.coordinates },
        properties: Object.fromEntries(sample.intensityByHour.map((value, index) => ["h" + index, value])),
      })),
    });
  }, [filteredMobility, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.setLayoutProperty("mobility-heat", "visibility", visible.mobility && !comparison ? "visible" : "none");
    map.setLayoutProperty("mobility-gain", "visibility", visible.mobility && comparison ? "visible" : "none");
    map.setLayoutProperty("mobility-loss", "visibility", visible.mobility && comparison ? "visible" : "none");
    map.setPaintProperty("mobility-heat", "heatmap-weight", ["get", "h" + hour]);
    map.setPaintProperty("mobility-gain", "heatmap-weight",
      ["max", 0, ["-", ["get", "h" + hour], ["get", "h" + compareHour]]]);
    map.setPaintProperty("mobility-loss", "heatmap-weight",
      ["max", 0, ["-", ["get", "h" + compareHour], ["get", "h" + hour]]]);
  }, [visible.mobility, hour, compareHour, comparison, mapReady]);

  useEffect(() => {
    if (!playing || !visible.mobility) return;
    const timer = window.setInterval(() => setHour((current) => (current + 1) % 24), 900 / speed);
    return () => window.clearInterval(timer);
  }, [playing, visible.mobility, speed]);

  const storeResolution = level === 0 ? 5 : level === 1 ? 6 : 7;
  const storeHexes = useMemo(
    () => aggregateStores(filteredStores, country.brands, storeResolution),
    [filteredStores, country, storeResolution],
  );
  const storesByHex = useMemo(() => {
    const grouped = new Map<string, Store[]>();
    for (const store of filteredStores) {
      const hex = cellToParent(store.hex, storeResolution);
      const list = grouped.get(hex) ?? [];
      list.push(store);
      grouped.set(hex, list);
    }
    return grouped;
  }, [filteredStores, storeResolution]);
  const showStore = (store: Store, count?: number, position?: number) => {
    lastOverlayClickRef.current = Date.now();
    setSelected({
      title: store.name,
      detail:
        store.brandName +
        " · " +
        store.city +
        (count
          ? " · " + position + " de " + count + " tiendas en esta celda"
          : ""),
      address: store.address,
      description: store.description,
      hex: store.hex,
      storeId: store.id,
    });
  };

  const layers = useMemo(() => {
    const output = [];
    if (visible.stores) {
      output.push(
        new H3HexagonLayer({
          id: country.id + "-store-hexes-" + storeResolution,
          data: storeHexes,
          getHexagon: (item) => item.hex,
          getFillColor: (item) =>
            [...item.color, visible.mobility ? Math.min(95, 30 + item.count * 2) : Math.min(210, 75 + item.count * 4)] as [
              number,
              number,
              number,
              number,
            ],
          getLineColor: (item) =>
            [...item.color, visible.mobility ? 130 : 230] as [number, number, number, number],
          lineWidthMinPixels: 1,
          stroked: true,
          filled: true,
          extruded: false,
          pickable: true,
          onClick: (info) => {
            if (!info.object) return;
            if (level >= 2) {
              const point = overlayRef.current?.pickMultipleObjects({
                x: info.x,
                y: info.y,
                radius: 8,
                depth: 1,
                layerIds: [country.id + "-stores"],
              })[0];
              if (point?.object) {
                showStore(point.object as Store);
                return;
              }
            }
            const candidates = storesByHex.get(info.object.hex) ?? [];
            if (!candidates.length) return;
            const key = country.id + ":" + info.object.hex;
            const next = hexClickRef.current.get(key) ?? 0;
            showStore(
              candidates[next % candidates.length],
              candidates.length,
              (next % candidates.length) + 1,
            );
            hexClickRef.current.set(key, next + 1);
          },
        }),
      );
      if (level >= (visible.mobility ? 1 : 2))
        output.push(
          new ScatterplotLayer({
            id: country.id + "-stores",
            data: filteredStores,
            getPosition: (item) => item.coordinates,
            getRadius: 90,
            radiusMinPixels: 4,
            radiusMaxPixels: 9,
            getFillColor: (item) =>
              [...item.color, 240] as [number, number, number, number],
            getLineColor: [255, 255, 255, 255],
            lineWidthMinPixels: 1,
            stroked: true,
            pickable: true,
            onClick: (info) => {
              if (info.object) showStore(info.object);
            },
          }),
        );
    }
    return output;
  }, [
    country,
    filteredStores,
    visible.stores,
    visible.mobility,
    level,
    storeHexes,
    storeResolution,
    storesByHex,
  ]);
  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <div className="miq-logo-wrap">
            <img src="/miq-logo.png" alt="MiQ" width="92" height="38" />
          </div>
          <div className="brand-copy">
            <span className="brand-kicker">PROPUESTA DE DEMO</span>
            <strong>Retail intelligence</strong>
            <small>Explorador geoespacial</small>
          </div>
        </div>
        <div className="divider" />
        <section className="section">
          <span className="eyebrow">01 / MERCADO</span>
          <label className="field-label" htmlFor="country">
            País
          </label>
          <select
            id="country"
            value={countryId}
            onChange={(event) => {
              setLevel(0);
              setCountryId(event.target.value);
            }}
          >
            {countries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="hint">
            Explora cobertura retail, zonas H3 y actividad simulada por mercado.
          </p>
        </section>
        <div className="divider" />
        <section className="section search-section">
          <label className="field-label" htmlFor="map-search">Buscar ubicación o ciudad</label>
          <input id="map-search" type="search" value={searchQuery}
            placeholder="Ej. Costco Miami"
            onChange={(event) => setSearchQuery(event.target.value)} />
          {searchQuery.trim().length >= 2 && (
            <div className="search-results" role="listbox" aria-label="Resultados de búsqueda">
              {searchResults.length ? searchResults.map((result) => (
                <button type="button" key={result.kind + result.label}
                  onClick={() => {
                    if (result.kind === "city") {
                      mapRef.current?.flyTo({ center: result.city.coordinates, zoom: 10, duration: 850 });
                      setSelected({ title: result.city.name, detail: result.city.region });
                    } else {
                      setHiddenBrands((current) => current.filter((id) => id !== result.store.brandId));
                      setVisible((current) => ({ ...current, stores: true }));
                      mapRef.current?.flyTo({ center: result.store.coordinates, zoom: 12, duration: 850 });
                      showStore(result.store);
                    }
                    setSearchQuery("");
                  }}>
                  <span>{result.kind === "city" ? "Ciudad" : "Tienda"}</span>
                  <strong>{result.label}</strong>
                </button>
              )) : <p>Sin resultados en este país.</p>}
            </div>
          )}
        </section>
        <div className="miq-overview">
          <span className="eyebrow">VISTA DEL MERCADO</span>
          <div className="metrics" aria-label="Resumen de la vista">
            <div><strong>{filteredStores.length}</strong><span>Tiendas de ejemplo</span></div>
            <div><strong>{storeHexes.length}</strong><span>Zonas H3</span></div>
            <div><strong>{activityIndex}</strong><span>Índice horario</span></div>
          </div>
        </div>
        <div className="divider" />
        <section className="section layers-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">02 / EXPLORAR</span>
              <h2>Señales en el mapa</h2>
            </div>
            <span className="count">3</span>
          </div>
          <div className="layer-list">
            {layerMeta.map((layer) => (
              <label className="layer-card" key={layer.id}>
                <input
                  type="checkbox"
                  checked={visible[layer.id]}
                  onChange={(event) =>
                    setVisible((current) => ({
                      ...current,
                      [layer.id]: event.target.checked,
                    }))
                  }
                />
                <span className="swatch" style={{ background: layer.color }} />
                <span className="layer-copy">
                  <strong>{layer.name}</strong>
                  <small>{layer.description}</small>
                </span>
                <span className="switch" aria-hidden="true" />
              </label>
            ))}
          </div>
          <div className="brand-list" aria-label="Filtrar cadenas de tiendas">
            <div className="brand-list-heading">
              <span className="eyebrow">CADENAS EN {country.name.toUpperCase()}</span>
              <span>{filteredStores.length} puntos</span>
            </div>
            {country.brands.map((brand) => (
              <div className="brand-row" key={brand.id}>
                <input type="checkbox" checked={!hiddenBrands.includes(brand.id)}
                  aria-label={"Mostrar " + brand.name}
                  onChange={(event) => setHiddenBrands((current) =>
                    event.target.checked ? current.filter((id) => id !== brand.id) : [...current, brand.id])} />
                <span className="brand-swatch" style={{ background: "rgb(" + brand.color.join(",") + ")" }} />
                <strong>{brand.name}</strong>
                <small>{filteredStores.filter((store) => store.brandId === brand.id).length}</small>
                <a href={brand.sourceUrl} target="_blank" rel="noopener noreferrer"
                  aria-label={"Sitio oficial de " + brand.name} title="Ver sucursales oficiales">↗</a>
              </div>
            ))}
            <p>Filtra las cadenas para comparar sus H3 y el calor simulado. Las ubicaciones son ficticias.</p>
          </div>
          <div className="hour-control">
            <div className="hour-heading">
              <label htmlFor="mobility-hour">Actividad por hora</label>
              <output htmlFor="mobility-hour">{String(hour).padStart(2, "0")}:00</output>
            </div>
            <input id="mobility-hour" type="range" min="0" max="23" step="1"
              value={hour} disabled={!visible.mobility}
              onChange={(event) => { setPlaying(false); setHour(Number(event.target.value)); }}
              aria-label="Hora de movilidad" />
            <div className="hour-scale"><span>00:00</span><span>12:00</span><span>23:00</span></div>
            <div className="playback-controls">
              <button type="button" disabled={!visible.mobility}
                onClick={() => setPlaying((current) => !current)}
                aria-label={playing ? "Pausar reproducción" : "Reproducir el día"}>
                {playing ? "Pausar" : "Reproducir"}
              </button>
              <label htmlFor="playback-speed">Velocidad</label>
              <select id="playback-speed" value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}>
                <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
              </select>
            </div>
            <label className="compare-toggle">
              <input type="checkbox" checked={comparison} disabled={!visible.mobility}
                onChange={(event) => setComparison(event.target.checked)} />
              Comparar con otra hora
            </label>
            {comparison && (
              <div className="comparison-controls">
                <label htmlFor="compare-hour">Hora de referencia</label>
                <select id="compare-hour" value={compareHour}
                  onChange={(event) => setCompareHour(Number(event.target.value))}>
                  {Array.from({ length: 24 }, (_, value) =>
                    <option key={value} value={value}>{String(value).padStart(2, "0")}:00</option>)}
                </select>
                <p>
                  Índice {String(compareHour).padStart(2, "0")}:00: {referenceIndex}
                  {" → "} {String(hour).padStart(2, "0")}:00: {activityIndex}
                  {" · "} Cambio: {activityIndex - referenceIndex > 0 ? "+" : ""}
                  {activityIndex - referenceIndex} puntos
                </p>
                <div className="comparison-key"><span>Aumento</span><span>Disminución</span></div>
                <div className="city-changes">
                  {cityChanges.map((city) => <div key={city.name}>
                    <span>{city.name}</span><strong>{city.change > 0 ? "+" : ""}{city.change}</strong>
                  </div>)}
                </div>
              </div>
            )}
            <p className="mobility-note">Actividad simulada cerca de tiendas. El índice es relativo; no representa personas ni trayectorias reales.</p>
          </div>
          <div className="legend">
            <span>Concentración simulada a las {String(hour).padStart(2, "0")}:00</span>
            <div className="legend-gradient" />
            <div className="legend-scale">
              <span>Menor</span>
              <span>Mayor concentración</span>
            </div>
          </div>
        </section>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Prototipo para MiQ · Datos simulados
        </div>
      </aside>
      <section
        className="map-area"
        aria-label="Mapa de límites, tiendas H3 y calor de movilidad"
      >
        <div ref={containerRef} className="map-canvas" />
        <div className="map-top">
          <div className="location-pill">
            <span className="location-dot" /> {country.name}
            <span className="pill-separator" />{" "}
            {boundaryLevelName(country.id, level)}
          </div>
          <div className="map-label">
            MIQ <span>/</span> GEO RETAIL <small>DEMO</small>
          </div>
        </div>
        {selected && (
          <div className="selection-card">
            <button
              type="button"
              aria-label="Cerrar detalle"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <span className="eyebrow">PERFIL DE UBICACIÓN</span>
            <strong>{selected.title}</strong>
            <p>{selected.detail}</p>
            {selected.address && (
              <p>
                <strong>Dirección ficticia</strong>
                <br />
                {selected.address}
              </p>
            )}
            {selected.description && <p>{selected.description}</p>}
            {selectedStore && (
              <div className="store-analysis">
                <div className="analysis-heading">
                  <strong>Actividad por hora</strong>
                  <span>{String(hour).padStart(2, "0")}:00 · {storeProfile[hour]}/100</span>
                </div>
                <svg viewBox="0 0 280 104" role="img"
                  aria-label={"Perfil horario simulado de " + selectedStore.name}>
                  <polyline fill="none" stroke="#dce8e2" strokeWidth="1"
                    points="8,88 272,88" />
                  <polyline fill="none"
                    stroke={"rgb(" + selectedStore.color.join(",") + ")"}
                    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    points={storeProfile.map((value, index) =>
                      (8 + index * 264 / 23) + "," + (88 - value * 0.72)).join(" ")} />
                  <circle cx={8 + hour * 264 / 23} cy={88 - storeProfile[hour] * 0.72}
                    r="5" fill={"rgb(" + selectedStore.color.join(",") + ")"}
                    stroke="white" strokeWidth="2" />
                </svg>
                <div className="chart-hours"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
                <div className="radius-heading">
                  <strong>Tiendas cercanas</strong><span>{nearbyStores.length} en el radio</span>
                </div>
                <div className="radius-options" role="group" aria-label="Radio de búsqueda">
                  {[1, 3, 5].map((value) => (
                    <button type="button" key={value}
                      className={radiusKm === value ? "active" : ""}
                      aria-pressed={radiusKm === value}
                      onClick={() => setRadiusKm(value)}>{value} km</button>
                  ))}
                </div>
                <div className="nearby-list">
                  {nearbyStores.length ? nearbyStores.slice(0, 4).map(({ store, km }) => (
                    <button type="button" key={store.id}
                      onClick={() => {
                        showStore(store);
                        mapRef.current?.flyTo({ center: store.coordinates, zoom: 12, duration: 650 });
                      }}>
                      <span className="nearby-swatch" style={{ background: "rgb(" + store.color.join(",") + ")" }} />
                      <span>{store.name}</span><small>{km.toFixed(1)} km</small>
                    </button>
                  )) : <p>No hay otras tiendas visibles en este radio.</p>}
                </div>
                <p className="analysis-note">Actividad y ubicaciones de demostración.</p>
              </div>
            )}
            {selected.hex && <code>{selected.hex}</code>}
          </div>
        )}
        {mapError && (
          <div className="map-error" role="status">
            No se pudo cargar parte del mapa. Comprueba tu conexión.
          </div>
        )}
        <div className="map-footer">
          <span>Análisis exploratorio · Datos de demostración</span>
          <span>© OpenStreetMap · geoBoundaries</span>
        </div>
      </section>
    </main>
  );
}
