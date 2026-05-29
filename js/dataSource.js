/**
 * Источник данных о статусе воздушных оповещений по регионам.
 *
 * Оба источника — реальные, через локальный бэкенд (см. server.js):
 *   - Украина (UA): официальный канал ВС Украины @kpszsu  → /api/ua-alerts
 *     (статусы областей + движения шахедов/БПЛА).
 *   - Россия (RU): неофициальный агрегатор @radarrussiia   → /api/ru-alerts.
 *
 * Статус "тревога" снимается автоматически, если по региону тихо дольше TTL
 * (логика на бэкенде в parseCommon.computeStatuses).
 */
(function () {
  "use strict";

  function unknownFor(country) {
    const out = {};
    window.REGIONS.filter((r) => r.country === country).forEach((r) => {
      out[r.id] = "unknown";
    });
    return out;
  }

  // Все регионы страны по умолчанию "clear", сверху накладываем статусы фида.
  function baseClear(country) {
    const out = {};
    window.REGIONS.filter((r) => r.country === country).forEach((r) => {
      out[r.id] = "clear";
    });
    return out;
  }

  async function fetchFeed(endpoint, country) {
    const resp = await fetch(endpoint, { cache: "no-store" });
    if (!resp.ok) throw new Error("backend " + resp.status);
    const data = await resp.json();

    const out = baseClear(country);
    Object.entries(data.statuses || {}).forEach(([id, st]) => {
      if (out[id] !== undefined) out[id] = st;
    });
    return { statuses: out, meta: data };
  }

  window.DataSource = {
    isLive: true,

    // Метаданные последнего обновления (для интерфейса).
    meta: { ua: null, ru: null },
    shaheds: [],
    drones: [],

    /** Возвращает Promise<{ regionId: status }> для обеих стран. */
    async getStatuses() {
      const [ua, ru] = await Promise.all([
        fetchFeed("/api/ua-alerts", "UA").catch((e) => {
          console.error("UA live недоступен (запущен ли server.js?):", e);
          return { statuses: unknownFor("UA"), meta: null };
        }),
        fetchFeed("/api/ru-alerts", "RU").catch((e) => {
          console.error("RU live недоступен:", e);
          return { statuses: unknownFor("RU"), meta: null };
        }),
      ]);

      this.meta.ua = ua.meta;
      this.meta.ru = ru.meta;
      this.shaheds = (ua.meta && ua.meta.shaheds) || [];
      this.drones = (ru.meta && ru.meta.drones) || [];

      return Object.assign({}, ua.statuses, ru.statuses);
    },
  };
})();
