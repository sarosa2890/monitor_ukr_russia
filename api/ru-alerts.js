/**
 * Vercel serverless-функция: статусы регионов РФ по каналу @radarrussiia.
 * Кэш на стороне Vercel (s-maxage) заменяет in-memory кэш из server.js.
 */
"use strict";

const ruParser = require("../js/ruParser.js");

const CHANNEL_URL = "https://t.me/s/radarrussiia";

module.exports = async (req, res) => {
  try {
    const resp = await fetch(CHANNEL_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ru,en;q=0.8",
      },
    });
    if (!resp.ok) throw new Error("Telegram ответил " + resp.status);

    const html = await resp.text();
    const payload = ruParser.parseChannel(html);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).send(JSON.stringify(payload));
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
