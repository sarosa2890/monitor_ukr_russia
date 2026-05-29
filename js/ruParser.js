/**
 * Парсер публичной ленты Telegram-канала @radarrussiia (Россия).
 *
 * Превращает HTML страницы t.me/s/radarrussiia в события по регионам РФ.
 * Эвристика, не official-данные: формулировки разбираются по ключевым словам.
 *
 * Статусы регионов вычисляются централизованно в parseCommon.computeStatuses
 * с учётом времени: если по региону тихо дольше TTL — он считается "clear".
 */
"use strict";

const {
  extractMessages,
  hasAny,
  computeStatuses,
  parseTime,
} = require("./parseCommon.js");
const { RU_PLACES, findPlaces } = require("./places.js");

// Тревога снимается, если по региону нет новых сообщений N времени.
const RU_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа

// Стем (часть слова) → id региона из js/regions.js.
const REGION_STEMS = [
  ["ru-belgorod", ["белгород"]],
  ["ru-bryansk", ["брянск", "брянщин"]],
  ["ru-kursk", ["курск", "курчатов", "курщин"]],
  ["ru-voronezh", ["воронеж", "бобровск", "острогожск", "лискинск"]],
  ["ru-rostov", ["ростовск", "ростов-на", "таганрог", "чертковск", "миллеровск", "кашары", "морозовск", "суровикино"]],
  [
    "ru-krasnodar",
    [
      "краснодар", "кубан", "анапа", "новороссийск", "сочи", "адлер",
      "туапсе", "геленджик", "темрюк", "приморско-ахтарск",
      "славянск-на-кубани", "ильск", "афипск", "ейск", "армавир",
    ],
  ],
  ["ru-volgograd", ["волгоград"]],
  ["ru-lipetsk", ["липецк", "елец"]],
  ["ru-tula", ["тульск", "тула", "туле", "новомосковск"]],
  ["ru-oryol", ["орловск", "орёл", "орел", "орле", "орлов"]],
  ["ru-smolensk", ["смоленск"]],
  ["ru-moscow-oblast", ["московск", "подмосков"]],
  ["ru-istra", ["истра", "истре", "истринск"]],
  ["ru-moscow", ["москва", "москве", "москву"]],
  ["ru-kaluga", ["калуж", "калуга", "калуге", "обнинск"]],
  ["ru-ryazan", ["рязан"]],
  ["ru-tambov", ["тамбов"]],
  ["ru-saratov", ["саратов", "энгельс", "балаково"]],
  ["ru-penza", ["пензен", "пенза", "пензе"]],
  ["ru-tver", ["твер"]],
  ["ru-yaroslavl", ["ярославл"]],
  ["ru-vladimir", ["владимирск", "владимир"]],
  ["ru-ivanovo", ["ивановск", "иваново"]],
  ["ru-nnovgorod", ["нижегород", "нижний новгород", "дзержинск"]],
  ["ru-ulyanovsk", ["ульяновск"]],
  ["ru-samara", ["самарск", "самара", "тольятти", "сызран"]],
  ["ru-astrakhan", ["астрахан"]],
  ["ru-stavropol", ["ставропол"]],
  ["ru-adygea", ["адыге"]],
  ["ru-crimea", ["крым", "крыму", "севастопол", "симферопол", "джанкой"]],
  ["ru-mordovia", ["мордови", "саранск"]],
  ["ru-chuvashia", ["чуваш", "чебоксар"]],
  ["ru-tatarstan", ["татарстан", "казан", "елабуг", "нижнекамск", "алабуга"]],
  ["ru-spb", ["санкт-петербург", "петербург"]],
  ["ru-leningrad", ["ленинградск"]],
];

const CLEAR_WORDS = ["отбой", "🟢", "угроза миновала", "опасность миновала", "чисто"];

const ALERT_WORDS = [
  "опасность", "тревога", "угроза", "внимание", "бпла",
  "ракетная", "взлёт", "взлет", "пуски", "фиксаци", "удар",
];

// Сообщения-сводки/отчёты (прошедшее время) — НЕ влияют на статус.
const REPORT_WORDS = [
  "уничтожен", "сбит", "перехвачен", "ликвидирован", "обломки",
  "за прошедш", "за минувш", "силами пво", "минобороны", "по данным",
  "итог", "сводка", "с 08:00", "с 20:00", "за сутки", "за ночь",
];

/**
 * Регионы, упомянутые в тексте.
 * excludeSource=true отбрасывает регионы после " от " (направление угрозы).
 */
function matchRegions(text, excludeSource) {
  let scope = text.toLowerCase();
  if (excludeSource) {
    const otIdx = scope.indexOf(" от ");
    if (otIdx !== -1) scope = scope.slice(0, otIdx);
  }
  const found = new Set();
  REGION_STEMS.forEach(([id, stems]) => {
    if (stems.some((stem) => scope.indexOf(stem) !== -1)) found.add(id);
  });
  return [...found];
}

/**
 * Главная функция. На вход — HTML страницы канала.
 * На выход — { source, official, ttlMs, updatedAt, statuses, events }.
 */
function parseChannel(html) {
  const now = Date.now();
  const messages = extractMessages(html);
  const events = [];
  const drones = [];

  messages.forEach((msg) => {
    const lower = msg.text.toLowerCase();
    if (hasAny(lower, REPORT_WORDS)) return;

    const isClear = hasAny(lower, CLEAR_WORDS);
    const isAlert = !isClear && hasAny(lower, ALERT_WORDS);
    if (!isClear && !isAlert) return;

    const regions = matchRegions(msg.text, true);
    if (regions.length === 0) return;

    const time = parseTime(msg.datetime, now);

    events.push({
      type: isClear ? "clear" : "alert",
      regions,
      text: msg.text,
      datetime: msg.datetime,
      time,
    });

    // Примерное расположение БПЛА — для свежих активных угроз.
    if (isAlert && now - time <= RU_TTL_MS) {
      const places = findPlaces(msg.text, RU_PLACES);
      drones.push({
        kind: "drone",
        regions,
        places, // именованные точки из текста (могут отсутствовать)
        text: msg.text,
        datetime: msg.datetime,
        time,
      });
    }
  });

  const statuses = computeStatuses(events, RU_TTL_MS, now);

  return {
    source: "@radarrussiia",
    official: false,
    ttlMs: RU_TTL_MS,
    updatedAt: new Date(now).toISOString(),
    statuses,
    drones: drones.slice(-50),
    events: events.slice(-60),
  };
}

module.exports = { parseChannel, matchRegions, REGION_STEMS, RU_TTL_MS };
