// Candles, bars and a histogram sized by per-bar slot widths, with a whitespace point and a second pane.
function generateData() {
	const candles = [];
	const widths = [];
	const time = new Date(Date.UTC(2018, 0, 1, 0, 0, 0, 0));
	for (let i = 0; i < 60; ++i) {
		const t = time.getTime() / 1000;
		time.setUTCDate(time.getUTCDate() + 1);
		if (i === 30) {
			candles.push({ time: t });
			continue;
		}
		const base = 100 + 10 * Math.sin(i / 5);
		candles.push({ time: t, open: base - 2, high: base + 4, low: base - 4, close: base + (i % 2 === 0 ? 2 : -3), volume: 1 + (i % 7) });
		widths.push({ time: t, width: [0.5, 1, 1.5, 3, 1, 0.75, 2][i % 7] });
	}
	return { candles, widths };
}

function runTestCase(container) {
	const chart = window.chart = LightweightCharts.createChart(container, { layout: { attributionLogo: false } });
	const { candles, widths } = generateData();

	const candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries);
	candleSeries.setData(candles);

	const barSeries = chart.addSeries(LightweightCharts.BarSeries, { upColor: '#2962FF', downColor: '#FF6D00' }, 1);
	barSeries.setData(candles.map(c => (c.open === undefined ? { time: c.time } : { ...c, open: c.open + 20, high: c.high + 20, low: c.low + 20, close: c.close + 20 })));

	const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'volume' }, 1);
	volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
	volumeSeries.setData(candles.map(c => (c.volume === undefined ? { time: c.time } : { time: c.time, value: c.volume })));

	chart.timeScale().setSlotWidths(widths);
	chart.timeScale().fitContent();
}
