import {
	CandlestickData,
	IChartApi,
	ISeriesApi,
	SlotWidth,
	Time,
} from 'lightweight-charts';

/** A candle with the traded volume that sizes its slot. */
export interface VolumeCandle extends CandlestickData<Time> {
	volume: number;
}

/**
 * Maps volume to a relative slot width: `(volume / referenceVolume) ^ exponent`, clamped to `[minWidth, maxWidth]`.
 * A square root (`exponent: 0.5`) keeps heavy bars visibly wider without squeezing the rest of the chart.
 */
export interface VolumeWeighting {
	exponent: number;
	minWidth: number;
	maxWidth: number;
}

export const defaultVolumeWeighting: VolumeWeighting = {
	exponent: 0.5,
	minWidth: 0.6,
	maxWidth: 3,
};

/** Median volume, a reference that a few outliers don't move. Returns 1 for no positive volumes. */
export function medianVolume(candles: readonly VolumeCandle[]): number {
	const volumes = candles
		.map(candle => candle.volume)
		.filter(volume => volume > 0)
		.sort((a, b) => a - b);
	if (volumes.length === 0) {
		return 1;
	}
	const middle = Math.floor(volumes.length / 2);
	return volumes.length % 2 === 1 ? volumes[middle] : (volumes[middle - 1] + volumes[middle]) / 2;
}

export function volumeSlotWidth(volume: number, referenceVolume: number, weighting: VolumeWeighting): number {
	const ratio = Math.max(0, volume) / referenceVolume;
	return Math.min(weighting.maxWidth, Math.max(weighting.minWidth, Math.pow(ratio, weighting.exponent)));
}

/**
 * Keeps a candlestick series and the time scale's slot widths in step.
 * The reference volume is fixed by the first `setData`, so later updates only send the widths that changed.
 */
export class VariableWidthCandles {
	private readonly _chart: IChartApi;
	private readonly _series: ISeriesApi<'Candlestick'>;
	private readonly _weighting: VolumeWeighting;
	private _candles: VolumeCandle[] = [];
	private _referenceVolume: number = 1;

	public constructor(chart: IChartApi, series: ISeriesApi<'Candlestick'>, weighting: VolumeWeighting = defaultVolumeWeighting) {
		this._chart = chart;
		this._series = series;
		this._weighting = weighting;
	}

	public setData(candles: readonly VolumeCandle[]): void {
		this._candles = [...candles];
		this._referenceVolume = medianVolume(candles);
		this._series.setData(this._candles);
		this._chart.timeScale().setSlotWidths(this._widths(this._candles));
	}

	/** Adds or replaces the last candle, e.g. a still-forming bar. */
	public update(candle: VolumeCandle): void {
		const last = this._candles[this._candles.length - 1];
		const behavior = this._chart.horzBehaviour();
		if (last !== undefined && behavior.key(last.time) === behavior.key(candle.time)) {
			this._candles[this._candles.length - 1] = candle;
		} else {
			this._candles.push(candle);
		}
		this._series.update(candle);
		this._chart.timeScale().updateSlotWidths(this._widths([candle]));
	}

	/** Adds older candles at the left edge; widths already set stay attached to their times. */
	public prepend(olderCandles: readonly VolumeCandle[]): void {
		this._candles = [...olderCandles, ...this._candles];
		this._series.setData(this._candles);
		this._chart.timeScale().updateSlotWidths(this._widths(olderCandles));
	}

	private _widths(candles: readonly VolumeCandle[]): SlotWidth<Time>[] {
		return candles.map(candle => ({
			time: candle.time,
			width: volumeSlotWidth(candle.volume, this._referenceVolume, this._weighting),
		}));
	}
}
