/**
 * Общие утилиты парсинга публичных лент Telegram (t.me/s/...).
 * Используются серверными парсерами ruParser.js и uaParser.js (Node).
 */
"use strict";

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html) {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Делит HTML страницы канала на сообщения, достаёт текст и дату (ISO).
 * Возвращает массив { text, datetime } в порядке от старых к новым.
 */
function extractMessages(html) {
  const messages = [];
  const parts = html.split("tgme_widget_message_bubble");
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];

    const textMatch = seg.match(
      /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/
    );
    if (!textMatch) continue;
    const text = stripHtml(textMatch[1]);
    if (!text) continue;

    const dateMatch = seg.match(/datetime="([^"]+)"/);
    const datetime = dateMatch ? dateMatch[1] : null;

    messages.push({ text, datetime });
  }
  return messages;
}

function hasAny(lowerText, words) {
  return words.some((w) => lowerText.indexOf(w) !== -1);
}

/**
 * Считает статусы регионов по событиям с учётом времени (TTL).
 *
 * Логика: для каждого региона берём ПОСЛЕДНЕЕ событие.
 *   - если это "отбой" (clear)        → clear
 *   - если "тревога" (alert) и свежее ttlMs → alert
 *   - если "тревога", но старше ttlMs  → clear  (тихо N часов = всё спокойно)
 *
 * events: [{ type:'alert'|'clear', regions:[id], time:ms }]
 */
function computeStatuses(events, ttlMs, now) {
  const latest = {}; // regionId → { type, time }
  events.forEach((ev) => {
    ev.regions.forEach((id) => {
      if (!latest[id] || ev.time >= latest[id].time) {
        latest[id] = { type: ev.type, time: ev.time };
      }
    });
  });

  const statuses = {};
  Object.keys(latest).forEach((id) => {
    const info = latest[id];
    if (info.type === "clear") {
      statuses[id] = "clear";
    } else {
      statuses[id] = now - info.time <= ttlMs ? "alert" : "clear";
    }
  });
  return statuses;
}

function parseTime(datetime, fallbackNow) {
  const t = datetime ? Date.parse(datetime) : NaN;
  return Number.isNaN(t) ? fallbackNow : t;
}

module.exports = {
  decodeEntities,
  stripHtml,
  extractMessages,
  hasAny,
  computeStatuses,
  parseTime,
};
