// features/mapping/ui-map.js — embeds Leaflet.js pointed at the LOCAL,
// pre-cached OSM tile endpoint (no internet required after tiles are fetched).
import { apiGet } from '../../js/api-client.js';

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-map scanline';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header"><span class="crt-dot"></span> ASSET CLUSTER MAP</div>
      <div id="leaflet-map" class="map-viewport"></div>
    </div>
  `;

  // Leaflet is loaded globally via a <script> tag in index.html.
  const map = L.map(el.querySelector('#leaflet-map')).setView([8.365, 124.867], 16);

  L.tileLayer('/static/map_tiles/{z}/{x}/{y}.png', {
    maxZoom: 18,
    minZoom: 14,
    attribution: '&copy; OpenStreetMap contributors — cached offline for NBSC campus'
  }).addTo(map);

  apiGet('/api/v1/map/geojson?zoom=16').then((geojson) => {
    if (!geojson.features) return;
    L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 8 + Math.min(feature.properties.count, 10),
          color: '#4B5694',
          fillColor: '#7288AE',
          fillOpacity: 0.85,
          weight: 3
        }).bindPopup(`${feature.properties.count} asset(s): ${feature.properties.rooms.join(', ')}`)
    }).addTo(map);
  });

  return el;
}
