"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import {
  Activity,
  ChevronUp,
  Clock3,
  Filter,
  Globe2,
  Languages,
  Layers3,
  Map,
  RotateCcw,
  Search,
  Store as StoreIcon,
  type LucideIcon,
} from "lucide-react";
import {
  aggregateStores,
  countries,
  type Store,
  type StoreHex,
} from "./map-data";
import { translations, type Language } from "./translations";
import {
  boundaryLevel,
  boundaryUrl,
  countryBounds,
  type BoundaryLevel,
} from "./boundary-data";
import "maplibre-gl/dist/maplibre-gl.css";

const mapStyle = "https://tiles.openfreemap.org/styles/liberty";
const defaultCountry =
  countries.find((item) => item.id === "us") ?? countries[0];
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
  hexId?: string;
  storeId?: string;
  boundaryKind?: "local" | "region" | "country";
};
const layerMeta: {
  id: LayerId;
  color: string;
  icon: LucideIcon;
}[] = [
  { id: "stores", color: "#EA00AD", icon: StoreIcon },
  { id: "territory", color: "#6A2876", icon: Map },
  { id: "mobility", color: "#FF6500", icon: Activity },
];

function hexColor(item: StoreHex): [number, number, number] {
  const brands = Object.keys(item.brandCounts).length;
  if (brands >= 8) return [208, 54, 101];
  if (brands >= 4) return [177, 61, 164];
  if (brands >= 2) return [114, 83, 178];
  return [74, 129, 179];
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRadians = Math.PI / 180;
  const latitudeDelta = (b[1] - a[1]) * toRadians;
  const longitudeDelta = (b[0] - a[0]) * toRadians;
  const part =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a[1] * toRadians) *
      Math.cos(b[1] * toRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(part), Math.sqrt(1 - part));
}

function radiusPolygon(center: [number, number], radiusKm: number) {
  const [longitude, latitude] = center;
  const coordinates = Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    return [
      longitude +
        (Math.cos(angle) * radiusKm) /
          (111.32 * Math.cos((latitude * Math.PI) / 180)),
      latitude + (Math.sin(angle) * radiusKm) / 110.57,
    ];
  });
  coordinates[64] = coordinates[0];
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [coordinates] },
      },
    ],
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
    onSelect({
      title: String(feature.properties?.name ?? ""),
      detail: "",
      boundaryKind:
        feature.layer.id === "local-fill"
          ? "local"
          : feature.layer.id === "region-fill"
            ? "region"
            : "country",
    });
  });
}
export default function MapExplorer() {
  const [language, setLanguage] = useState<Language>("en");
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const t = translations[language];
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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const loadedRef = useRef({ country: "", region: "", local: "" });
  const countryFitRef = useRef(false);
  const lastOverlayClickRef = useRef(0);
  const country =
    countries.find((item) => item.id === countryId) ?? defaultCountry;
  const countryLabel =
    t.countryNames[country.id as keyof typeof t.countryNames] ?? country.name;
  const boundaryLabel =
    t.boundaryNames[country.id as keyof typeof t.boundaryNames]?.[level] ??
    t.country;
  const selectedTitle = selected?.hexId
    ? t.h3Cell
    : selected?.title || t.noName;
  const selectedDetail = selected?.hexId
    ? t.cellCoverage
    : selected?.boundaryKind === "local"
      ? t.localDivision
      : selected?.boundaryKind === "region"
        ? t.regionDivision
        : selected?.boundaryKind === "country"
          ? t.country
          : selected?.detail;

  useEffect(() => {
    const saved = window.localStorage.getItem("miq-language");
    if (saved === "es" || saved === "en" || saved === "pt") setLanguage(saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem("miq-language", language);
  }, [language]);
  const filteredStores = useMemo(
    () =>
      country.stores.filter((store) => !hiddenBrands.includes(store.brandId)),
    [country, hiddenBrands],
  );
  const filteredMobility = useMemo(
    () =>
      country.mobility.filter(
        (sample) => !hiddenBrands.includes(sample.brandId),
      ),
    [country, hiddenBrands],
  );
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query.length < 2) return [];
    const cities = country.cities
      .filter((city) => city.name.toLocaleLowerCase().includes(query))
      .slice(0, 3)
      .map((city) => ({
        kind: "city" as const,
        label: city.name + ", " + city.region,
        city,
      }));
    const stores = country.stores
      .filter(
        (store) =>
          store.name.toLocaleLowerCase().includes(query) ||
          store.address.toLocaleLowerCase().includes(query),
      )
      .slice(0, 6)
      .map((store) => ({ kind: "store" as const, label: store.name, store }));
    return [...cities, ...stores].slice(0, 8);
  }, [country, searchQuery]);
  const selectedStore = selected?.storeId
    ? country.stores.find((store) => store.id === selected.storeId)
    : undefined;
  const storeSamples = selectedStore
    ? country.mobility.filter((sample) => sample.storeId === selectedStore.id)
    : [];
  const storePassersby = storeSamples[0]?.passersbyByHour[hour] ?? 0;
  const storeProfile = Array.from({ length: 24 }, (_, index) =>
    storeSamples.length
      ? Math.round(
          (storeSamples.reduce(
            (sum, sample) => sum + sample.intensityByHour[index],
            0,
          ) /
            storeSamples.length) *
            100,
        )
      : 0,
  );
  const nearbyStores = selectedStore
    ? filteredStores
        .filter((store) => store.id !== selectedStore.id)
        .map((store) => ({
          store,
          km: distanceKm(selectedStore.coordinates, store.coordinates),
        }))
        .filter((item) => item.km <= radiusKm)
        .sort((a, b) => a.km - b.km)
    : [];
  const activityIndex = filteredMobility.length
    ? Math.round(
        (filteredMobility.reduce(
          (sum, sample) => sum + sample.intensityByHour[hour],
          0,
        ) /
          filteredMobility.length) *
          100,
      )
    : 0;
  const referenceIndex = filteredMobility.length
    ? Math.round(
        (filteredMobility.reduce(
          (sum, sample) => sum + sample.intensityByHour[compareHour],
          0,
        ) /
          filteredMobility.length) *
          100,
      )
    : 0;
  const cityChanges = useMemo(
    () =>
      country.cities
        .map((city) => {
          const samples = filteredMobility.filter(
            (sample) => sample.city === city.name,
          );
          const current = samples.reduce(
            (sum, sample) => sum + sample.intensityByHour[hour],
            0,
          );
          const reference = samples.reduce(
            (sum, sample) => sum + sample.intensityByHour[compareHour],
            0,
          );
          return {
            name: city.name,
            change: samples.length
              ? Math.round(((current - reference) / samples.length) * 100)
              : 0,
          };
        })
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 3),
    [country, filteredMobility, hour, compareHour],
  );

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
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
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
    const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
    map.on("load", () => {
      // Ocultar solo el relleno de colegios que distrae de las celdas H3.
      for (const layer of map.getStyle().layers ?? []) {
        if (
          layer.type === "fill-extrusion" ||
          layer.type === "hillshade" ||
          layer.id.toLowerCase().includes("building") ||
          layer.id === "landuse_school"
        ) {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }
      map.setTerrain(null);
      addBoundaryLayers(
        map,
        setSelected,
        () => Date.now() - lastOverlayClickRef.current < 300,
      );
      map.addSource("mobility-stores", {
        type: "geojson",
        data: emptyCollection,
      });
      map.addSource("store-radius", { type: "geojson", data: emptyCollection });
      map.addLayer({
        id: "store-radius-fill",
        type: "fill",
        source: "store-radius",
        paint: { "fill-color": "#df258f", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "store-radius-line",
        type: "line",
        source: "store-radius",
        paint: {
          "line-color": "#b82283",
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });
      // Todo el mapa base, los límites y el radio quedan debajo de H3 y tiendas.
      for (const { id, color } of [
        { id: "mobility-nearby", color: "#ff8a36" },
        { id: "mobility-nearby-gain", color: "#ed6948" },
        { id: "mobility-nearby-loss", color: "#4b9acb" },
      ]) {
        map.addLayer({
          id,
          type: "circle",
          source: "mobility-stores",
          minzoom: 11,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              22,
              13,
              32,
              16,
              44,
            ],
            "circle-color": color,
            "circle-blur": 0.5,
            "circle-opacity": 0,
          },
        });
      }
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
    source.setData(
      selectedStore
        ? radiusPolygon(selectedStore.coordinates, radiusKm)
        : emptyCollection,
    );
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
    const source = map.getSource("mobility-stores") as maplibregl.GeoJSONSource;
    source.setData({
      type: "FeatureCollection",
      features: filteredMobility.map((sample) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: sample.coordinates },
        properties: Object.fromEntries(
          sample.passersbyByHour.map((value, index) => ["p" + index, value]),
        ),
      })),
    });
  }, [filteredMobility, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.setLayoutProperty(
      "mobility-nearby",
      "visibility",
      visible.mobility && !comparison ? "visible" : "none",
    );
    map.setLayoutProperty(
      "mobility-nearby-gain",
      "visibility",
      visible.mobility && comparison ? "visible" : "none",
    );
    map.setLayoutProperty(
      "mobility-nearby-loss",
      "visibility",
      visible.mobility && comparison ? "visible" : "none",
    );
    map.setPaintProperty("mobility-nearby", "circle-color", [
      "interpolate",
      ["linear"],
      ["get", "p" + hour],
      20,
      "#fff3a3",
      90,
      "#ffe36a",
      160,
      "#ffb83d",
      220,
      "#ff7938",
    ]);
    map.setPaintProperty("mobility-nearby", "circle-opacity", [
      "interpolate",
      ["linear"],
      ["get", "p" + hour],
      20,
      0.58,
      220,
      0.85,
    ]);
    map.setPaintProperty("mobility-nearby-gain", "circle-opacity", [
      "*",
      0.005,
      ["max", 0, ["-", ["get", "p" + hour], ["get", "p" + compareHour]]],
    ]);
    map.setPaintProperty("mobility-nearby-loss", "circle-opacity", [
      "*",
      0.005,
      ["max", 0, ["-", ["get", "p" + compareHour], ["get", "p" + hour]]],
    ]);
  }, [visible.mobility, hour, compareHour, comparison, mapReady]);

  useEffect(() => {
    if (!playing || !visible.mobility) return;
    const timer = window.setInterval(
      () => setHour((current) => (current + 1) % 24),
      900 / speed,
    );
    return () => window.clearInterval(timer);
  }, [playing, visible.mobility, speed]);

  const storeResolution = level === 0 ? 5 : level === 1 ? 6 : 7;
  const storeHexes = useMemo(
    () => aggregateStores(filteredStores, storeResolution),
    [filteredStores, storeResolution],
  );
  const selectedHex = selected?.hexId
    ? storeHexes.find((item) => item.hex === selected.hexId)
    : undefined;
  const showStore = (store: Store) => {
    lastOverlayClickRef.current = Date.now();
    setSelected({
      title: store.name,
      detail: store.brandName + " · " + store.city,
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
          beforeId: "mobility-nearby",
          parameters: { depthWriteEnabled: false },
          data: storeHexes,
          getHexagon: (item) => item.hex,
          getFillColor: (item) =>
            [...hexColor(item), visible.mobility ? 130 : 240] as [
              number,
              number,
              number,
              number,
            ],
          getLineColor: (item) =>
            [...hexColor(item), 235] as [number, number, number, number],
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
            const cell = info.object as StoreHex;
            lastOverlayClickRef.current = Date.now();
            setSelected({
              title: "Celda H3",
              detail: "Cobertura de cadenas en esta zona",
              hexId: cell.hex,
            });
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
            radiusMinPixels: 6,
            radiusMaxPixels: 11,
            getFillColor: (item) =>
              [...item.color, 255] as [number, number, number, number],
            getLineColor: [255, 255, 255, 255],
            lineWidthMinPixels: 2,
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
  ]);
  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  return (
    <main className="workspace">
      <aside className={"sidebar" + (mobileFiltersOpen ? " sidebar-open" : "")}>
        <button
          type="button"
          className="mobile-filter-toggle"
          aria-expanded={mobileFiltersOpen}
          onClick={() => setMobileFiltersOpen((current) => !current)}
        >
          <span className="mobile-filter-symbol">
            <Filter size={18} aria-hidden="true" />
          </span>
          <span className="mobile-filter-toggle-copy">
            <strong>{t.filters}</strong>
            <small>
              {countryLabel} · {filteredStores.length} {t.stores}
            </small>
          </span>
          <span className="mobile-filter-chevron" aria-hidden="true">
            <ChevronUp size={19} />
          </span>
        </button>
        <div className="brand">
          <div className="miq-logo-wrap">
            <img src="/miq-logo.png" alt="MiQ" width="92" height="38" />
          </div>
          <div className="brand-copy">
            <span className="brand-kicker">{t.demo}</span>
            <strong>Retail intelligence</strong>
            <small>{t.explorer}</small>
          </div>
        </div>
        <div className="divider" />
        <section className="section">
          <span className="eyebrow">01 / {t.market}</span>
          <label className="field-label label-with-icon" htmlFor="country">
            <Globe2 size={16} aria-hidden="true" /> {t.country}
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
                {t.countryNames[item.id as keyof typeof t.countryNames] ??
                  item.name}
              </option>
            ))}
          </select>
          <p className="hint">{t.marketHint}</p>
        </section>
        <div className="divider" />
        <section className="section search-section">
          <label className="field-label label-with-icon" htmlFor="map-search">
            <Search size={16} aria-hidden="true" /> {t.search}
          </label>
          <input
            id="map-search"
            type="search"
            value={searchQuery}
            placeholder={t.searchPlaceholder}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery.trim().length >= 2 && (
            <div
              className="search-results"
              role="listbox"
              aria-label={t.searchResults}
            >
              {searchResults.length ? (
                searchResults.map((result) => (
                  <button
                    type="button"
                    key={result.kind + result.label}
                    onClick={() => {
                      if (result.kind === "city") {
                        mapRef.current?.flyTo({
                          center: result.city.coordinates,
                          zoom: 10,
                          duration: 850,
                        });
                        setSelected({
                          title: result.city.name,
                          detail: result.city.region,
                        });
                      } else {
                        setHiddenBrands((current) =>
                          current.filter((id) => id !== result.store.brandId),
                        );
                        setVisible((current) => ({ ...current, stores: true }));
                        mapRef.current?.flyTo({
                          center: result.store.coordinates,
                          zoom: 12,
                          duration: 850,
                        });
                        showStore(result.store);
                      }
                      setSearchQuery("");
                      setMobileFiltersOpen(false);
                    }}
                  >
                    <span>{result.kind === "city" ? t.city : t.store}</span>
                    <strong>{result.label}</strong>
                  </button>
                ))
              ) : (
                <p>{t.noResults}</p>
              )}
            </div>
          )}
        </section>
        <div className="miq-overview">
          <span className="eyebrow">{t.marketView}</span>
          <div className="metrics" aria-label={t.marketView}>
            <div>
              <strong>{filteredStores.length}</strong>
              <span>{t.exampleStores}</span>
            </div>
            <div>
              <strong>{storeHexes.length}</strong>
              <span>{t.h3Zones}</span>
            </div>
            <div>
              <strong>{activityIndex}</strong>
              <span>{t.hourlyIndex}</span>
            </div>
          </div>
        </div>
        <div className="divider" />
        <section className="section layers-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">02 / {t.explore}</span>
              <h2 className="label-with-icon">
                <Layers3 size={19} aria-hidden="true" /> {t.mapSignals}
              </h2>
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
                <span className="layer-symbol" style={{ color: layer.color }}>
                  <layer.icon size={18} aria-hidden="true" />
                </span>
                <span className="layer-copy">
                  <strong>
                    {layer.id === "stores"
                      ? t.layerStores
                      : layer.id === "territory"
                        ? t.layerTerritory
                        : t.layerActivity}
                  </strong>
                  <small>
                    {layer.id === "stores"
                      ? t.layerStoresDesc
                      : layer.id === "territory"
                        ? t.layerTerritoryDesc
                        : t.layerActivityDesc}
                  </small>
                </span>
                <span className="switch" aria-hidden="true" />
              </label>
            ))}
          </div>
          <div className="brand-list" aria-label={t.filters}>
            <div className="brand-list-heading">
              <span className="eyebrow label-with-icon">
                <StoreIcon size={14} aria-hidden="true" /> {t.chainsIn}{" "}
                {countryLabel.toUpperCase()}
              </span>
              <span>
                {filteredStores.length} {t.points}
              </span>
            </div>
            <div className="brand-actions">
              <button type="button" onClick={() => setHiddenBrands([])}>
                {t.showAll}
              </button>
              <button
                type="button"
                onClick={() =>
                  setHiddenBrands(country.brands.map((brand) => brand.id))
                }
              >
                {t.hideAll}
              </button>
            </div>
            {country.brands.map((brand) => (
              <div className="brand-row" key={brand.id}>
                <input
                  type="checkbox"
                  checked={!hiddenBrands.includes(brand.id)}
                  aria-label={t.showBrand + " " + brand.name}
                  onChange={(event) =>
                    setHiddenBrands((current) =>
                      event.target.checked
                        ? current.filter((id) => id !== brand.id)
                        : [...current, brand.id],
                    )
                  }
                />
                <span
                  className="brand-swatch"
                  style={{ background: "rgb(" + brand.color.join(",") + ")" }}
                />
                <strong>{brand.name}</strong>
                <small>
                  {
                    filteredStores.filter((store) => store.brandId === brand.id)
                      .length
                  }
                </small>
                <a
                  href={brand.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t.officialSite + " " + brand.name}
                  title={t.officialStores}
                >
                  ↗
                </a>
              </div>
            ))}
            <p>{t.brandHint}</p>
          </div>
          <div className="hex-legend" aria-label={t.hexColors}>
            <strong>{t.hexVariety}</strong>
            <p>{t.hexHint}</p>
            <div className="hex-legend-items">
              {[
                { label: "1", color: [74, 129, 179] },
                { label: "2–3", color: [114, 83, 178] },
                { label: "4–7", color: [177, 61, 164] },
                { label: "8+", color: [208, 54, 101] },
              ].map((step) => (
                <span key={step.label}>
                  <i style={{ background: `rgb(${step.color.join(",")})` }} />
                  {step.label}
                </span>
              ))}
            </div>
          </div>
          <div className="hour-control">
            <div className="hour-heading">
              <label className="label-with-icon" htmlFor="mobility-hour">
                <Clock3 size={16} aria-hidden="true" /> {t.hourlyActivity}
              </label>
              <output htmlFor="mobility-hour">
                {String(hour).padStart(2, "0")}:00
              </output>
            </div>
            <input
              id="mobility-hour"
              type="range"
              min="0"
              max="23"
              step="1"
              value={hour}
              disabled={!visible.mobility}
              onChange={(event) => {
                setPlaying(false);
                setHour(Number(event.target.value));
              }}
              aria-label={t.mobilityHour}
            />
            <div className="hour-scale">
              <span>00:00</span>
              <span>12:00</span>
              <span>23:00</span>
            </div>
            <div className="playback-controls">
              <button
                type="button"
                disabled={!visible.mobility}
                onClick={() => setPlaying((current) => !current)}
                aria-label={playing ? t.pause : t.play + " " + t.dayPlayback}
              >
                {playing ? t.pause : t.play}
              </button>
              <label htmlFor="playback-speed">{t.speed}</label>
              <select
                id="playback-speed"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </div>
            <label className="compare-toggle">
              <input
                type="checkbox"
                checked={comparison}
                disabled={!visible.mobility}
                onChange={(event) => setComparison(event.target.checked)}
              />
              {t.compare}
            </label>
            {comparison && (
              <div className="comparison-controls">
                <label htmlFor="compare-hour">{t.referenceHour}</label>
                <select
                  id="compare-hour"
                  value={compareHour}
                  onChange={(event) =>
                    setCompareHour(Number(event.target.value))
                  }
                >
                  {Array.from({ length: 24 }, (_, value) => (
                    <option key={value} value={value}>
                      {String(value).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <p>
                  {t.index} {String(compareHour).padStart(2, "0")}:00:{" "}
                  {referenceIndex}
                  {" → "} {String(hour).padStart(2, "0")}:00: {activityIndex}
                  {" · "} {t.change}:{" "}
                  {activityIndex - referenceIndex > 0 ? "+" : ""}
                  {activityIndex - referenceIndex} {t.pointsUnit}
                </p>
                <div className="comparison-key">
                  <span>{t.increase}</span>
                  <span>{t.decrease}</span>
                </div>
                <div className="city-changes">
                  {cityChanges.map((city) => (
                    <div key={city.name}>
                      <span>{city.name}</span>
                      <strong>
                        {city.change > 0 ? "+" : ""}
                        {city.change}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mobility-note">{t.mobilityNote}</p>
          </div>
          <div className="legend">
            <span>
              {t.simulatedPeople} {String(hour).padStart(2, "0")}:00 ·{" "}
              {t.visibleFrom}
            </span>
            <div className="legend-gradient" />
            <div className="legend-scale">
              <span>20 {t.perHour}</span>
              <span>220 {t.perHour}</span>
            </div>
          </div>
        </section>
        <div className="sidebar-bottom">
          <span className="status-dot" /> {t.prototype}
        </div>
      </aside>
      {mobileFiltersOpen && (
        <button
          type="button"
          className="mobile-filter-backdrop"
          aria-label={t.closeFilters}
          onClick={() => setMobileFiltersOpen(false)}
        />
      )}
      <section className="map-area" aria-label={t.mapAria}>
        <div ref={containerRef} className="map-canvas" />
        <div className="map-top">
          <div className="location-pill">
            <span className="location-dot" /> {countryLabel}
            <span className="pill-separator" /> {boundaryLabel}
          </div>
          <div className="map-top-actions">
            <div className="language-control">
              <button
                type="button"
                className="language-button"
                aria-label={t.language}
                aria-expanded={languageMenuOpen}
                onClick={() => setLanguageMenuOpen((current) => !current)}
              >
                <Languages size={16} aria-hidden="true" />{" "}
                {language.toUpperCase()}
              </button>
              {languageMenuOpen && (
                <div
                  className="language-menu"
                  role="group"
                  aria-label={t.language}
                >
                  {(
                    [
                      ["es", "Español"],
                      ["en", "English"],
                      ["pt", "Português"],
                    ] as const
                  ).map(([code, name]) => (
                    <button
                      type="button"
                      key={code}
                      lang={code}
                      aria-pressed={language === code}
                      onClick={() => {
                        setLanguage(code);
                        setLanguageMenuOpen(false);
                      }}
                    >
                      <span>{code.toUpperCase()}</span>
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="reset-view"
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                setSelected(null);
                map.fitBounds(countryBounds[country.id], {
                  padding: map.getContainer().clientWidth < 700 ? 24 : 48,
                  duration: 850,
                  maxZoom: 5,
                  bearing: 0,
                  pitch: 0,
                });
              }}
              aria-label={t.resetViewAria}
            >
              <RotateCcw size={15} aria-hidden="true" />{" "}
              <span className="reset-view-label">{t.resetView}</span>
            </button>
            <div className="map-label">
              MIQ <span>/</span> GEO RETAIL <small>DEMO</small>
            </div>
          </div>
        </div>
        {selected && (!selected.hexId || selectedHex) && (
          <div className="selection-card">
            <button
              type="button"
              aria-label={t.closeDetail}
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <span className="eyebrow">{t.locationProfile}</span>
            <strong>{selectedTitle}</strong>
            <p>{selectedDetail}</p>
            {selectedHex && (
              <div className="hex-details">
                <p>
                  <strong>{selectedHex.count}</strong> {t.examplePoints} ·{" "}
                  <strong>{Object.keys(selectedHex.brandCounts).length}</strong>{" "}
                  {t.chains}
                </p>
                <div className="hex-brand-breakdown">
                  {country.brands
                    .filter((brand) => selectedHex.brandCounts[brand.id])
                    .sort(
                      (a, b) =>
                        selectedHex.brandCounts[b.id] -
                        selectedHex.brandCounts[a.id],
                    )
                    .map((brand) => (
                      <div key={brand.id}>
                        <i
                          style={{
                            background: `rgb(${brand.color.join(",")})`,
                          }}
                        />
                        <span>{brand.name}</span>
                        <strong>{selectedHex.brandCounts[brand.id]}</strong>
                      </div>
                    ))}
                </div>
                <code>{selectedHex.hex}</code>
              </div>
            )}
            {selected.address && (
              <p>
                <strong>{t.fictionalAddress}</strong>
                <br />
                {selected.address}
              </p>
            )}
            {selectedStore && (
              <p>
                {t.storeDescription} {selectedStore.brandName}{" "}
                {language === "en" ? "in" : language === "pt" ? "em" : "en"}{" "}
                {selectedStore.city}. {t.fictionalPoint}
              </p>
            )}
            {!selectedStore && selected.description && (
              <p>{selected.description}</p>
            )}
            {selectedStore && (
              <div className="store-analysis">
                <div className="analysis-heading">
                  <strong>{t.peopleNearby}</strong>
                  <span>
                    {String(hour).padStart(2, "0")}:00 · {storePassersby}{" "}
                    {t.perHour}
                  </span>
                </div>
                <svg
                  viewBox="0 0 280 104"
                  role="img"
                  aria-label={t.simulatedProfile + " " + selectedStore.name}
                >
                  <polyline
                    fill="none"
                    stroke="#dce8e2"
                    strokeWidth="1"
                    points="8,88 272,88"
                  />
                  <polyline
                    fill="none"
                    stroke={"rgb(" + selectedStore.color.join(",") + ")"}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={storeProfile
                      .map(
                        (value, index) =>
                          8 + (index * 264) / 23 + "," + (88 - value * 0.72),
                      )
                      .join(" ")}
                  />
                  <circle
                    cx={8 + (hour * 264) / 23}
                    cy={88 - storeProfile[hour] * 0.72}
                    r="5"
                    fill={"rgb(" + selectedStore.color.join(",") + ")"}
                    stroke="white"
                    strokeWidth="2"
                  />
                </svg>
                <div className="chart-hours">
                  <span>00</span>
                  <span>06</span>
                  <span>12</span>
                  <span>18</span>
                  <span>23</span>
                </div>
                <div className="radius-heading">
                  <strong>{t.nearbyStores}</strong>
                  <span>
                    {nearbyStores.length} {t.inRadius}
                  </span>
                </div>
                <div
                  className="radius-options"
                  role="group"
                  aria-label={t.searchRadius}
                >
                  {[1, 3, 5].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={radiusKm === value ? "active" : ""}
                      aria-pressed={radiusKm === value}
                      onClick={() => setRadiusKm(value)}
                    >
                      {value} {t.km}
                    </button>
                  ))}
                </div>
                <div className="nearby-list">
                  {nearbyStores.length ? (
                    nearbyStores.slice(0, 4).map(({ store, km }) => (
                      <button
                        type="button"
                        key={store.id}
                        onClick={() => {
                          showStore(store);
                          mapRef.current?.flyTo({
                            center: store.coordinates,
                            zoom: 12,
                            duration: 650,
                          });
                        }}
                      >
                        <span
                          className="nearby-swatch"
                          style={{
                            background: "rgb(" + store.color.join(",") + ")",
                          }}
                        />
                        <span>{store.name}</span>
                        <small>
                          {km.toFixed(1)} {t.km}
                        </small>
                      </button>
                    ))
                  ) : (
                    <p>{t.noNearby}</p>
                  )}
                </div>
                <p className="analysis-note">{t.analysisNote}</p>
              </div>
            )}
            {selected.hex && <code>{selected.hex}</code>}
          </div>
        )}
        {mapError && (
          <div className="map-error" role="status">
            {t.mapError}
          </div>
        )}
        <div className="map-footer">
          <span>{t.footer}</span>
          <span>© OpenStreetMap · geoBoundaries</span>
        </div>
      </section>
    </main>
  );
}
