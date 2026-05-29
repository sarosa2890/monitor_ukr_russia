/**
 * Локальный бэкенд-посредник.
 *
 * Зачем он нужен: страницы Telegram (t.me/s/...) не отдают CORS-заголовки,
 * поэтому браузер не может тянуть их напрямую через fetch. Этот сервер:
 *   1) отдаёт статические файлы приложения (index.html, css, js);
 *   2) /api/ru-alerts — статусы регионов РФ по каналу @radarrussiia;
 *   3) /api/ua-alerts — статусы областей Украины + движения шахедов
 *      по официальному каналу Воздушных Сил @kpszsu.
 *
 * Запуск:  node server.js   →  http://localhost:8080
 *
 * Достоверность:
 *   @kpszsu      — ОФИЦИАЛЬНЫЙ канал ВС Украины.
 *   @radarrussiia — НЕОФИЦИАЛЬНЫЙ агрегатор по РФ (не гарантирован).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const ruParser = require("./js/ruParser.js");
const uaParser = require("./js/uaParser.js");

const PORT = process.env.PORT || 8080;
const CACHE_TTL_MS = 30 * 1000; // не дёргать Telegram чаще раза в 30 сек

const FEEDS = {
  ru: { url: "https://t.me/s/radarrussiia", parse: ruParser.parseChannel },
  ua: { url: "https://t.me/s/kpszsu", parse: uaParser.parseChannel },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const cache = {}; // key → { at, payload }

async function getFeed(key) {
  const feed = FEEDS[key];
  const now = Date.now();
  if (cache[key] && now - cache[key].at < CACHE_TTL_MS) {
    return cache[key].payload;
  }

  const resp = await fetch(feed.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "ru,uk,en;q=0.8",
    },
  });
  if (!resp.ok) throw new Error("Telegram ответил " + resp.status);

  const html = await resp.text();
  const payload = feed.parse(html);
  cache[key] = { at: now, payload };
  return payload;
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(__dirname, path.normalize(urlPath));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const route = req.url.split("?")[0];

  if (route === "/api/ru-alerts" || route === "/api/ua-alerts") {
    const key = route === "/api/ru-alerts" ? "ru" : "ua";
    try {
      const payload = await getFeed(key);
      sendJson(res, 200, payload);
    } catch (e) {
      sendJson(res, 502, { error: String(e.message || e) });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log("Сервер запущен:  http://localhost:" + PORT);
  console.log("  РФ:      " + FEEDS.ru.url + "  (неофициальный)");
  console.log("  Украина: " + FEEDS.ua.url + "  (официальный)");
});
