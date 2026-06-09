// Netlify Function: datos de mercado vía Alpha Vantage
// La API key vive aquí (variable de entorno), nunca en el frontend.
export const handler = async (event) => {
  const { ticker = "AAPL", timeframe = "D" } = event.queryStringParameters || {};
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "ALPHAVANTAGE_API_KEY no configurada en Netlify" }) };
  }

  // Mapeo de timeframe → función de Alpha Vantage
  let url, seriesKey;
  if (timeframe === "D") {
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${apiKey}`;
    seriesKey = "Time Series (Daily)";
  } else {
    const interval = timeframe === "15M" ? "15min" : "60min";
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${ticker}&interval=${interval}&outputsize=full&apikey=${apiKey}`;
    seriesKey = `Time Series (${interval})`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.Note || data.Information) {
      return { statusCode: 429, body: JSON.stringify({ error: "Límite de Alpha Vantage alcanzado. Intenta en un momento.", detail: data.Note || data.Information }) };
    }
    const series = data[seriesKey];
    if (!series) {
      return { statusCode: 404, body: JSON.stringify({ error: "Sin datos para " + ticker, detail: data }) };
    }

    // Transformar a array de velas
    const isIntraday = timeframe !== "D";
    let candles = Object.entries(series).map(([t, v]) => ({
      time: isIntraday ? Math.floor(new Date(t.replace(" ", "T") + "Z").getTime() / 1000) : t,
      open: +v["1. open"], high: +v["2. high"], low: +v["3. low"], close: +v["4. close"],
      volume: +v["5. volume"],
    }));

    // Orden ascendente estricto (Lightweight Charts lo exige)
    candles.sort((a, b) => {
      if (typeof a.time === "string") return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      return a.time - b.time;
    });
    // Eliminar timestamps duplicados (quedarse con el último)
    candles = candles.filter((c, i) => i === candles.length - 1 || c.time !== candles[i + 1].time);

    // Agregar 60min → 4H en ventanas fijas de 4 horas (alineadas, sin cruzar)
    if (timeframe === "4H") {
      const buckets = new Map();
      const W = 4 * 3600;
      for (const c of candles) {
        const bt = Math.floor(c.time / W) * W;
        const b = buckets.get(bt);
        if (!b) {
          buckets.set(bt, { time: bt, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
        } else {
          b.high = Math.max(b.high, c.high);
          b.low = Math.min(b.low, c.low);
          b.close = c.close;
          b.volume += c.volume;
        }
      }
      candles = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    }

    // Limitar historia intradía para mantener el gráfico ágil
    if (isIntraday) {
      const cap = timeframe === "4H" ? 250 : 400;
      candles = candles.slice(-cap);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, timeframe, candles }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
