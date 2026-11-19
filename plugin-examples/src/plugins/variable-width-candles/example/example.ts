import { CandlestickSeries, createChart, HistogramSeries, UTCTimestamp } from 'lightweight-charts';
import { SlotBoxes } from '../slot-boxes';
import { VariableWidthCandles, VolumeCandle } from '../variable-width-candles';

const daySeconds = 24 * 60 * 60;
const initialCount = 300;
const historyChunk = 100;
const liveTickMs = 500;
const ticksPerBar = 10;

const chart = ((window as unknown as { chart: unknown }).chart = createChart('chart', {
	autoSize: true,
}));

const candleSeries = chart.addSeries(CandlestickSeries);
candleSeries.attachPrimitive(new SlotBoxes());
const volumeSeries = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', color: 'rgba(120, 123, 134, 0.5)' });
volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

const candles = new VariableWidthCandles(chart, candleSeries);

let price = 100;
function randomCandle(time: number): VolumeCandle {
	const open = price;
	const close = open + (Math.random() - 0.5) * 4;
	price = close;
	// occasional volume spikes show the widths clearly
	const volume = Math.round(1000 * (Math.random() < 0.1 ? 3 + Math.random() * 6 : 0.4 + Math.random()));
	return {
		time: time as UTCTimestamp,
		open,
		close,
		high: Math.max(open, close) + Math.random() * 2,
		low: Math.min(open, close) - Math.random() * 2,
		volume,
	};
}

function volumeBar(candle: VolumeCandle) {
	return { time: candle.time, value: candle.volume };
}

let firstTime = Date.UTC(2024, 0, 1) / 1000;
let lastTime = firstTime + (initialCount - 1) * daySeconds;
const initial = Array.from({ length: initialCount }, (_, i) => randomCandle(firstTime + i * daySeconds));
let allCandles = initial;
candles.setData(initial);
volumeSeries.setData(initial.map(volumeBar));

// a still-forming bar: its volume, and so its width, grows with every tick
let live = randomCandle(lastTime + daySeconds);
let tick = 0;
setInterval(() => {
	tick += 1;
	if (tick % ticksPerBar === 0) {
		lastTime = live.time as number;
		live = randomCandle(lastTime + daySeconds);
	} else {
		const close = live.close + (Math.random() - 0.5);
		live = {
			...live,
			close,
			high: Math.max(live.high, close),
			low: Math.min(live.low, close),
			volume: live.volume + Math.round(Math.random() * 300),
		};
	}
	const lastIndex = allCandles.length - 1;
	if (allCandles[lastIndex].time === live.time) {
		allCandles[lastIndex] = live;
	} else {
		allCandles.push(live);
	}
	candles.update(live);
	volumeSeries.update(volumeBar(live));
}, liveTickMs);

// load older history when the user scrolls to the left edge
let loading = false;
chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
	if (range === null || range.from > 10 || loading) {
		return;
	}
	loading = true;
	firstTime -= historyChunk * daySeconds;
	const older = Array.from({ length: historyChunk }, (_, i) => randomCandle(firstTime + i * daySeconds));
	allCandles = [...older, ...allCandles];
	candles.prepend(older);
	volumeSeries.setData(allCandles.map(volumeBar));
	loading = false;
});
