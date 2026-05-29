/**
 * Vercel serverless-функция: статусы областей Украины + движения шахедов
 * по официальному каналу Воздушных Сил @kpszsu.
 */
"use strict";

const uaParser = require("../js/uaParser.js");

const CHANNEL_URL = "https://t.me/s/kpszsu";

module.exports = async (req, res) => {
  try {
    const resp = await fetch(CHANNEL_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "uk,ru,en;q=0.8",
      },
    });
    if (!resp.ok) throw new Error("Telegram ответил " + resp.status);

    const html = await resp.text();
    const payload = uaParser.parseChannel(html);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).send(JSON.stringify(payload));
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
