/**
 * Парсер публичной ленты Telegram-канала @kpszsu
 * (Повітряні Сили ЗС України — ОФИЦИАЛЬНЫЙ канал ВС Украины).
 *
 * Канал постит перемещения угроз: 🛵 = БпЛА (Shahed/«мопеды»),
 * 🚀 = пуски КАБ/ракет. Текст на украинском, области в разговорной форме
 * (Харківщина, Сумщина, Запоріжжя, Донеччина...).
 *
 * Из ленты извлекаем:
 *   - статусы областей (где сейчас активна угроза, с учётом TTL);
 *   - отдельный список движений БПЛА/шахедов (shaheds) с курсом.
 */
"use strict";

const {
  extractMessages,
  hasAny,
  computeStatuses,
  parseTime,
} = require("./parseCommon.js");
const { UA_PLACES, findPlaces } = require("./places.js");

// Для Украины угрозы движутся быстро — окно короче.
const UA_TTL_MS = 75 * 60 * 1000; // 75 минут

// Разговорные/официальные формы названий областей → id из regions.js.
const REGION_STEMS = [
  ["vinnytsia", ["вінниччин", "вінницьк"]],
  ["volyn", ["волин"]],
  ["dnipro", ["дніпропетровщин", "дніпропетровськ", "дніпро", "кривий ріг", "криворіж", "павлоград", "нікопол"]],
  ["donetsk", ["донеччин", "донецьк", "краматорськ", "слов'янськ", "покровськ"]],
  ["zhytomyr", ["житомирщин", "житомирськ"]],
  ["zakarpattia", ["закарпатт", "закарпатськ"]],
  ["zaporizhzhia", ["запоріжж", "запорізьк", "запорожь", "бердянськ", "мелітопол"]],
  ["ivano-frankivsk", ["прикарпатт", "івано-франків", "франківщин"]],
  ["kyiv-oblast", ["київщин", "київськ області", "київська область", "бориспіл", "бровар"]],
  ["kyiv-city", ["києв", "київ ", "м. київ", "столиц"]],
  ["kirovohrad", ["кіровоградщин", "кіровоградськ", "кропивницьк"]],
  ["luhansk", ["луганщин", "луганськ"]],
  ["lviv", ["львівщин", "львівськ", "львів"]],
  ["mykolaiv", ["миколаївщин", "миколаївськ", "миколаїв"]],
  ["odesa", ["одещин", "одеськ", "одес", "ізмаїл", "чорноморськ"]],
  ["poltava", ["полтавщин", "полтавськ", "кременчук", "пирятин"]],
  ["rivne", ["рівненщин", "рівненськ", "рівне"]],
  ["sumy", ["сумщин", "сумськ", "суми", "шостк", "конотоп", "вороніж"]],
  ["ternopil", ["тернопільщин", "тернопільськ", "тернопіл"]],
  ["kharkiv", ["харківщин", "харківськ", "харків", "балаклі", "ізюм", "чугуїв", "лозов", "куп'янськ"]],
  ["kherson", ["херсонщин", "херсонськ", "херсон", "каховк"]],
  ["khmelnytskyi", ["хмельниччин", "хмельницьк", "кам'янець"]],
  ["cherkasy", ["черкащин", "черкаськ", "черкаси", "умань", "сміла"]],
  ["chernivtsi", ["буковин", "чернівецьк", "чернівц"]],
  ["chernihiv", ["чернігівщин", "чернігівськ", "чернігів", "ніжин", "березна"]],
];

// 🛵 «мопед» / БпЛА / Shahed-угроза.
const SHAHED_WORDS = ["бпла", "🛵", "мопед", "shahed", "шахед", "герань", "безпілотник"];
// 🚀 КАБ / ракеты / пуски.
const MISSILE_WORDS = ["🚀", "ракет", "каб", "керованих авіаційних бомб", "пуски", "балістик", "крилат"];

const CLEAR_WORDS = ["відбій", "🟢", "загроза минула", "чисто", "відбій тривоги"];

// Сводки/итоги — не влияют на текущий статус.
const REPORT_WORDS = [
  "збито", "знищено", "ліквідовано", "уламки", "за минулу добу",
  "протягом ночі", "станом на", "всього", "підсумк", "зведенн",
];

function classifyKind(lower) {
  if (hasAny(lower, MISSILE_WORDS)) return "missile";
  if (hasAny(lower, SHAHED_WORDS)) return "shahed";
  return null;
}

function matchRegions(text) {
  const scope = text.toLowerCase();
  const found = new Set();
  REGION_STEMS.forEach(([id, stems]) => {
    if (stems.some((stem) => scope.indexOf(stem) !== -1)) found.add(id);
  });
  return [...found];
}

/**
 * Пытается вытащить «курс/направление» из сообщения для списка шахедов.
 * Примеры: "курсом на Шостку", "➡️ курсом на Старий Мерчик".
 */
function extractCourse(text) {
  const m = text.match(/курс(?:ом)?\s*[-:]?\s*(?:на|повз)?\s*([^.,]{2,40})/i);
  if (m) return m[1].trim();
  return null;
}

function parseChannel(html) {
  const now = Date.now();
  const messages = extractMessages(html);
  const events = [];
  const shaheds = [];

  messages.forEach((msg) => {
    const lower = msg.text.toLowerCase();
    if (hasAny(lower, REPORT_WORDS)) return;

    const isClear = hasAny(lower, CLEAR_WORDS);
    const kind = isClear ? null : classifyKind(lower);
    if (!isClear && !kind) return;

    const regions = matchRegions(msg.text);
    if (regions.length === 0) return;

    const time = parseTime(msg.datetime, now);

    events.push({
      type: isClear ? "clear" : "alert",
      kind: kind || "clear",
      regions,
      text: msg.text,
      datetime: msg.datetime,
      time,
    });

    // Активные движения шахедов/БПЛА — для отдельной панели.
    if (kind === "shahed" && now - time <= UA_TTL_MS) {
      shaheds.push({
        regions,
        course: extractCourse(msg.text),
        places: findPlaces(msg.text, UA_PLACES),
        text: msg.text,
        datetime: msg.datetime,
        time,
      });
    }
  });

  const statuses = computeStatuses(events, UA_TTL_MS, now);

  return {
    source: "@kpszsu",
    official: true,
    ttlMs: UA_TTL_MS,
    updatedAt: new Date(now).toISOString(),
    statuses,
    shaheds: shaheds.slice(-40),
    events: events.slice(-60),
  };
}

module.exports = { parseChannel, matchRegions, extractCourse, REGION_STEMS, UA_TTL_MS };
