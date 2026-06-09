import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

const STRATEGIES = ["PCS", "CCS", "BCS", "PDS", "IC", "IB"];
const TIMEFRAMES = ["D", "4H", "1H", "15M"];
const WATCHLIST = ["META", "HOOD", "NVDA", "PLTR", "SPY"];

function genCandles(n, start) {
  const out = []; let price = start; const base = new Date("2026-02-01").getTime();
  for (let i = 0; i < n; i++) {
    const t = new Date(base + i * 86400000);
    const drift = Math.sin(i / 9) * 3 + (Math.random() - 0.45) * 6;
    const open = price; const close = Math.max(20, price + drift);
    const high = Math.max(open, close) + Math.random() * 4;
    const low = Math.min(open, close) - Math.random() * 4;
    out.push({ time: t.toISOString().slice(0, 10), open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2) });
    price = close;
  }
  return out;
}
function ema(data, period) {
  const k = 2 / (period + 1); let prev = data[0]?.close || 0; const out = [];
  data.forEach((d, i) => { const v = i === 0 ? d.close : d.close * k + prev * (1 - k); prev = v; out.push({ time: d.time, value: +v.toFixed(2) }); });
  return out;
}

const cache = {};

export default function App() {
  const [ticker, setTicker] = useState("META");
  const [inputTicker, setInputTicker] = useState("META");
  const [timeframe, setTimeframe] = useState("D");
  const [strategy, setStrategy] = useState("PCS");
  const [candles, setCandles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [clock, setClock] = useState("");
  const [capital, setCapital] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [chartError, setChartError] = useState(null);

  const chartRef = useRef(null);
  const containerRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const ema20Ref = useRef(null);
  const ema50Ref = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date(); const p = (n) => String(n).padStart(2, "0");
      setClock(p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + " ET");
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: "solid", color: "transparent" }, textColor: "rgba(255,255,255,0.45)", fontFamily: "'DM Mono',monospace" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(245,158,11,0.4)", width: 1, labelBackgroundColor: "#B45309" }, horzLine: { color: "rgba(245,158,11,0.4)", labelBackgroundColor: "#B45309" } },
      width: containerRef.current.clientWidth, height: containerRef.current.clientHeight,
    });
    const cs = chart.addCandlestickSeries({ upColor: "#4ADE80", downColor: "#F87171", borderUpColor: "#4ADE80", borderDownColor: "#F87171", wickUpColor: "rgba(74,222,128,0.6)", wickDownColor: "rgba(248,113,133,0.6)" });
    const e20 = chart.addLineSeries({ color: "#F59E0B", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    const e50 = chart.addLineSeries({ color: "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    chartRef.current = chart; candleSeriesRef.current = cs; ema20Ref.current = e20; ema50Ref.current = e50;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }));
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, []);

  const loadMarket = useCallback(async (tk, tf) => {
    const key = tk + "|" + tf;
    if (cache[key]) { setCandles(cache[key]); setDemoMode(false); setChartError(null); return; }
    setLoadingChart(true); setChartError(null);
    try {
      const res = await fetch("/.netlify/functions/market?ticker=" + tk + "&timeframe=" + tf);
      if (!res.ok) throw new Error("market fn");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.candles || !data.candles.length) throw new Error("Sin datos");
      cache[key] = data.candles;
      setCandles(data.candles); setDemoMode(false);
    } catch (err) {
      if (err.message && err.message.includes("mite")) {
        setChartError("Límite de Alpha Vantage alcanzado. Espera un momento.");
      } else {
        setCandles(genCandles(110, 540)); setDemoMode(true);
      }
    } finally { setLoadingChart(false); }
  }, []);

  useEffect(() => { loadMarket(ticker, timeframe); }, [ticker, timeframe, loadMarket]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({ timeScale: { timeVisible: timeframe !== "D", secondsVisible: false } });
  }, [timeframe]);

  const lastFitKey = useRef("");
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;
    candleSeriesRef.current.setData(candles);
    ema20Ref.current.setData(ema(candles, 20));
    ema50Ref.current.setData(ema(candles, 50));
    const key = ticker + "|" + timeframe;
    if (lastFitKey.current !== key) { chartRef.current.timeScale().fitContent(); lastFitKey.current = key; }
  }, [candles, ticker, timeframe]);

  const priceLinesRef = useRef([]);
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach((pl) => series.removePriceLine(pl));
    priceLinesRef.current = [];
    if (!analysis) return;
    const draw = (price, color, title) => {
      const pl = series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title });
      priceLinesRef.current.push(pl);
    };
    (analysis.resistencias || []).forEach((p) => draw(p, "#F87171", "RES"));
    (analysis.soportes || []).forEach((p) => draw(p, "#4ADE80", "SOP"));
  }, [analysis]);

  const analyze = async () => {
    if (!candles.length) return;
    setLoadingAI(true); setAiError(null);
    const currentPrice = candles[candles.length - 1].close;
    try {
      const res = await fetch("/.netlify/functions/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, strategy, candles, currentPrice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error de análisis");
      setAnalysis(data);
    } catch (err) {
      setAiError(err.message || "No se pudo analizar.");
    } finally { setLoadingAI(false); }
  };

  const submitTicker = () => { const t = inputTicker.trim().toUpperCase(); if (t) { setTicker(t); setAnalysis(null); } };

  const onRestore = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { const parsed = JSON.parse(e.target.result); const d = parsed.data || parsed; setCapital(d.capital || null); } catch {}
    };
    reader.readAsText(file);
  };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const px = last ? last.close : 0;
  const chgPct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const cap = capital || { operativo: 4010, patrimonioCash: 8035, boveda: 3650, stocks: [] };
  const stocksVal = (cap.stocks || []).reduce((a, s) => a + (s.shares || 0) * (s.currentPrice || 0), 0);
  const patrimonio = (cap.patrimonioCash || 0) + stocksVal;
  const total = (cap.operativo || 0) + patrimonio + (cap.boveda || 0);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">📈</div>
          <div className="name">Trade<span>Lab</span></div>
          <div className="tag">TERMINAL</div>
        </div>
        <div className="topbar-right">
          <div className="market-status"><span className="dot" /> {demoMode ? "MODO DEMO" : "MERCADO ABIERTO"}</div>
          <div className="clock">{clock}</div>
          <button className="btn-import" onClick={() => fileRef.current?.click()}>+ Importar</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onRestore(f); e.target.value = ""; }} />
        </div>
      </div>

      <div className="main">
        <div className="sidebar panel">
          <div className="sec-label">Capital</div>
          <div className="cap-total">
            <div className="lbl">Capital Total</div>
            <div className="val">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="chg">{capital ? "importado del móvil" : "datos de ejemplo"}</div>
          </div>
          <div className="cap-block op">
            <div className="cap-block-top"><span className="k">Operativo</span><span className="v">${(cap.operativo || 0).toLocaleString()}</span></div>
          </div>
          <div className="cap-block pat"><div className="cap-block-top"><span className="k">Patrimonio</span><span className="v">${patrimonio.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div></div>
          <div className="cap-block bov"><div className="cap-block-top"><span className="k">Bóveda</span><span className="v">${(cap.boveda || 0).toLocaleString()}</span></div></div>

          <div className="sec-label" style={{ marginTop: 20 }}>Watchlist</div>
          {WATCHLIST.map((t) => (
            <div key={t} className={"wl" + (t === ticker ? " active" : "")} onClick={() => { setTicker(t); setInputTicker(t); setAnalysis(null); }}>
              <span className="wl-tk">{t}</span>
            </div>
          ))}
        </div>

        <div className="center">
          <div className="chart-head">
            <div className="tk-info">
              <div><span className="tk-sym">{ticker}</span></div>
              <span className="tk-px">{px ? "$" + px.toFixed(2) : "$—"}</span>
              <span className="tk-chg" style={{ background: chgPct >= 0 ? "rgba(74,222,128,0.12)" : "rgba(248,113,133,0.12)", color: chgPct >= 0 ? "var(--pos)" : "var(--neg)" }}>{chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%</span>
            </div>
            <div className="tf-tabs">
              {TIMEFRAMES.map((tf) => (
                <button key={tf} className={"tf" + (tf === timeframe ? " active" : "")} onClick={() => setTimeframe(tf)}>{tf}</button>
              ))}
            </div>
          </div>
          <div className="chart-wrap">
            <div className="chart-overlay-legend">
              <div className="leg"><span className="ln" style={{ background: "var(--gold)" }} /> EMA 20</div>
              <div className="leg"><span className="ln" style={{ background: "var(--blue)" }} /> EMA 50</div>
            </div>
            {analysis && <div className="ai-tag"><span className="d2" /> NIVELES IA</div>}
            {loadingChart && <div className="chart-loading">Cargando datos…</div>}
            {chartError && <div className="chart-loading" style={{ color: "var(--gold2)" }}>{chartError}</div>}
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
          </div>
        </div>

        <div className="ai-panel">
          <div className="ai-head">
            <div className="ic">◇</div>
            <div><div className="t">Co-piloto IA</div><div className="s">ANÁLISIS · TU SISTEMA</div></div>
          </div>
          {demoMode && <div className="banner">Modo demo. Configura las API keys en Netlify.</div>}
          <div className="ai-input">
            <input value={inputTicker} onChange={(e) => setInputTicker(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTicker()} placeholder="TICKER" />
          </div>
          <div className="ai-sel">
            {STRATEGIES.map((s) => (
              <button key={s} className={s === strategy ? "active" : ""} onClick={() => setStrategy(s)}>{s}</button>
            ))}
          </div>
          <button className="analyze-btn" onClick={analyze} disabled={loadingAI || !candles.length}>
            {loadingAI ? <><span className="spin">⟳</span> Analizando…</> : "Analizar " + ticker}
          </button>

          <div className="ai-out">
            {aiError && <div className="ai-card risk"><div className="ch">Error</div><div className="ai-text">{aiError}</div></div>}
            {!analysis && !aiError && (
              <div className="ai-empty">
                <div className="big">◇</div>
                <div className="msg">Escribe un ticker, elige tu estrategia y toca Analizar. La IA evaluará el setup según tu sistema.</div>
              </div>
            )}
            {analysis && (
              <>
                <div className="ai-card" style={{ animationDelay: "0.05s" }}>
                  <div className="ch">Tendencia</div>
                  <span className="trend-pill">{analysis.tendencia}</span>
                  {analysis.tendenciaNota && <div className="ai-text" style={{ marginTop: 8 }}>{analysis.tendenciaNota}</div>}
                </div>
                <div className="ai-card" style={{ animationDelay: "0.1s" }}>
                  <div className="ch">Soportes / Resistencias</div>
                  <div className="levels">
                    {(analysis.resistencias || []).map((p, i) => (
                      <div className="lvl" key={"r" + i}><span className="badge b-res">RES</span><span className="bar" style={{ background: "linear-gradient(90deg,transparent,var(--neg))" }} /><span className="px" style={{ color: "var(--neg)" }}>{Number(p).toFixed(2)}</span></div>
                    ))}
                    {(analysis.soportes || []).map((p, i) => (
                      <div className="lvl" key={"s" + i}><span className="badge b-sup">SOP</span><span className="bar" style={{ background: "linear-gradient(90deg,transparent,var(--pos))" }} /><span className="px" style={{ color: "var(--pos)" }}>{Number(p).toFixed(2)}</span></div>
                    ))}
                  </div>
                </div>
                {analysis.ivrNota && (
                  <div className="ai-card" style={{ animationDelay: "0.15s" }}>
                    <div className="ch">Sentimiento · Volatilidad</div>
                    <div className="ai-text">{analysis.ivrNota}</div>
                  </div>
                )}
                {analysis.tesis && (
                  <div className="ai-card" style={{ animationDelay: "0.2s" }}>
                    <div className="ch">Tesis del Setup</div>
                    <div className="ai-text">{analysis.tesis}</div>
                  </div>
                )}
                {analysis.riesgo && (
                  <div className="ai-card risk" style={{ animationDelay: "0.25s" }}>
                    <div className="ch">Riesgo</div>
                    <div className="ai-text">{analysis.riesgo}</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
