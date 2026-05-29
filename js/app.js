/**
 * Основная логика: инициализация карты, рендер маркеров и списка,
 * периодическое обновление статусов.
 */
(function () {
  "use strict";

  const REFRESH_MS = 15000; // обновление каждые 15 секунд

  const COLORS = {
    alert: "#ff4d4f",
    clear: "#2ecc71",
    unknown: "#6b7280",
  };

  const LABELS = {
    alert: "Тревога",
    clear: "Спокойно",
    unknown: "Нет данных",
  };

  const COUNTRY_NAMES = {
    UA: "Украина",
    RU: "Россия",
  };

  const map = L.map("map", {
    center: [50.5, 35.0],
    zoom: 5,
    zoomControl: true,
  });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }
  ).addTo(map);

  // Маркеры и элементы списка по id региона.
  const markers = {};
  const listItems = {};
  const regionById = {};
  window.REGIONS.forEach((r) => (regionById[r.id] = r));

  // Слой для маркеров примерного расположения дронов/шахедов (обе страны).
  const threatLayer = L.layerGroup().addTo(map);

  function makeMarker(region, status) {
    const color = COLORS[status] || COLORS.unknown;
    const isAlert = status === "alert";
    const radius = isAlert ? 14 : 9;

    const marker = L.circleMarker([region.lat, region.lng], {
      radius,
      color: color,
      weight: 2,
      fillColor: color,
      fillOpacity: isAlert ? 0.5 : 0.35,
    });

    marker.bindPopup(popupHtml(region, status));
    marker.bindTooltip(region.name, { direction: "top" });
    return marker;
  }

  function popupHtml(region, status) {
    return (
      '<div class="popup-title">' +
      region.name +
      "</div>" +
      '<div class="popup-state" style="color:' +
      (COLORS[status] || COLORS.unknown) +
      '">● ' +
      (LABELS[status] || LABELS.unknown) +
      "</div>"
    );
  }

  function buildList() {
    const container = document.getElementById("region-groups");
    container.innerHTML = "";

    // Порядок стран и группировка регионов.
    const order = ["UA", "RU"];
    const grouped = {};
    window.REGIONS.forEach((r) => {
      if (r.hidden) return;
      (grouped[r.country] = grouped[r.country] || []).push(r);
    });

    order.forEach((country) => {
      if (!grouped[country]) return;

      const groupTitle = document.createElement("h3");
      groupTitle.className = "group-title";
      groupTitle.textContent = COUNTRY_NAMES[country] || country;
      container.appendChild(groupTitle);

      const ul = document.createElement("ul");
      ul.className = "region-list";

      grouped[country].forEach((region) => {
        const li = document.createElement("li");
        li.className = "region-item";
        li.innerHTML =
          '<span class="dot dot-unknown"></span>' +
          '<span class="name">' +
          region.name +
          "</span>" +
          '<span class="state state-unknown">—</span>';
        li.addEventListener("click", () => {
          map.setView([region.lat, region.lng], 8, { animate: true });
          if (markers[region.id]) markers[region.id].openPopup();
        });
        ul.appendChild(li);
        listItems[region.id] = li;
      });

      container.appendChild(ul);
    });
  }

  function updateListItem(region, status) {
    const li = listItems[region.id];
    if (!li) return;
    const dot = li.querySelector(".dot");
    const state = li.querySelector(".state");

    dot.className = "dot dot-" + status;
    state.className = "state state-" + status;
    state.textContent = LABELS[status] || LABELS.unknown;
    li.classList.toggle("is-alert", status === "alert");
  }

  function render(statuses) {
    let alertCount = 0;
    let clearCount = 0;

    window.REGIONS.forEach((region) => {
      if (region.hidden) return;
      const status = statuses[region.id] || "unknown";
      if (status === "alert") alertCount++;
      else if (status === "clear") clearCount++;

      // Маркер пересоздаём, чтобы обновить размер/цвет.
      if (markers[region.id]) {
        const wasOpen = markers[region.id].isPopupOpen();
        map.removeLayer(markers[region.id]);
        markers[region.id] = makeMarker(region, status).addTo(map);
        if (wasOpen) markers[region.id].openPopup();
      } else {
        markers[region.id] = makeMarker(region, status).addTo(map);
      }

      updateListItem(region, status);
    });

    document.getElementById("count-alert").textContent = alertCount;
    document.getElementById("count-clear").textContent = clearCount;
    document.getElementById("last-updated").textContent =
      "обновлено: " + new Date().toLocaleTimeString("ru-RU");
  }

  function setModeBadge() {
    const badge = document.getElementById("mode-badge");
    badge.textContent = "ОНЛАЙН";
    badge.className = "badge badge-live";
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  // Рендер списка активных движений шахедов/БПЛА над Украиной.
  function renderShaheds(shaheds) {
    const list = document.getElementById("shahed-list");
    const counter = document.getElementById("shahed-count");
    counter.textContent = shaheds.length;

    list.innerHTML = "";
    if (!shaheds.length) {
      list.innerHTML =
        '<li class="shahed-empty muted">Нет активных движений</li>';
    } else {
      // показываем свежие сверху
      [...shaheds].reverse().forEach((s) => {
        const names = s.regions
          .map((id) => (regionById[id] ? regionById[id].name : id))
          .join(", ");
        const place = s.places && s.places.length ? s.places[0].name : null;
        const li = document.createElement("li");
        li.className = "shahed-row";
        li.innerHTML =
          '<span class="sh-region">' + names + "</span>" +
          (place ? ' <span class="sh-place">📍 ' + escapeHtml(place) + "</span>" : "") +
          (s.course
            ? ' <span class="sh-course">→ ' + escapeHtml(s.course) + "</span>"
            : "") +
          ' <span class="sh-time">' + formatTime(s.datetime) + "</span>";
        li.addEventListener("click", () => {
          const pos = threatPosition(s);
          if (pos) map.setView([pos.lat, pos.lng], 9, { animate: true });
        });
        list.appendChild(li);
      });
    }
  }

  // Координата угрозы: именованная точка из текста, иначе центр первого региона.
  function threatPosition(item) {
    if (item.places && item.places.length) {
      return { lat: item.places[0].lat, lng: item.places[0].lng };
    }
    const r = regionById[item.regions[0]];
    return r ? { lat: r.lat, lng: r.lng } : null;
  }

  // Маркеры примерного расположения дронов/шахедов на карте (обе страны).
  function renderThreatMarkers(shaheds, drones) {
    threatLayer.clearLayers();

    const plot = (item, emoji, label) => {
      const pos = threatPosition(item);
      if (!pos) return;
      const names = item.regions
        .map((id) => (regionById[id] ? regionById[id].name : id))
        .join(", ");
      const placeName =
        item.places && item.places.length ? item.places[0].name : null;
      const exact = !!placeName; // точка по н.п. или ориентировочно по области

      const m = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({
          className: "threat-icon" + (exact ? "" : " threat-approx"),
          html: emoji,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      });
      m.bindPopup(
        '<div class="popup-title">' + emoji + " " + label + "</div>" +
          '<div class="popup-state">Регион: ' + names + "</div>" +
          (placeName
            ? '<div class="popup-state">📍 ' + escapeHtml(placeName) + " (примерно)</div>"
            : '<div class="popup-state" style="color:#8b97a7">место по области (ориентировочно)</div>') +
          (item.course ? '<div class="popup-state">Курс: ' + escapeHtml(item.course) + "</div>" : "") +
          '<div class="popup-state" style="color:#8b97a7">' + formatTime(item.datetime) + "</div>"
      );
      m.addTo(threatLayer);
    };

    (shaheds || []).forEach((s) => plot(s, "🛵", "БПЛА/Шахед"));
    (drones || []).forEach((d) => plot(d, "✈️", "БПЛА"));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function tick() {
    try {
      const statuses = await window.DataSource.getStatuses();
      render(statuses);
      const shaheds = window.DataSource.shaheds || [];
      const drones = window.DataSource.drones || [];
      renderShaheds(shaheds);
      renderThreatMarkers(shaheds, drones);
    } catch (e) {
      console.error("Ошибка обновления:", e);
    }
  }

  // Старт
  buildList();
  setModeBadge();
  tick();
  setInterval(tick, REFRESH_MS);
})();
