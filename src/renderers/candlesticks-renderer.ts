import { BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import { fillRectInnerBorder } from '../helpers/canvas-helpers';

import { CandlesticksColorerStyle } from '../model/series-bar-colorer';
import { SlotLayout } from '../model/slot-layout';
import { SeriesItemsIndexesRange } from '../model/time-data';

import { BarCandlestickItemBase } from './bars-renderer';
import { BitmapCoordinatesPaneRenderer } from './bitmap-coordinates-pane-renderer';
import { optimalCandlestickWidth } from './optimal-bar-width';

export interface CandlestickItem extends BarCandlestickItemBase, CandlesticksColorerStyle {
}

export interface PaneRendererCandlesticksData {
	bars: readonly CandlestickItem[];

	barSpacing: number;
	/** Relative slot widths, or `null` when every bar uses `barSpacing`. */
	slots: SlotLayout | null;

	wickVisible: boolean;
	borderVisible: boolean;

	visibleRange: SeriesItemsIndexesRange | null;
}

const enum Constants {
	BarBorderWidth = 1,
}

export class PaneRendererCandlesticks extends BitmapCoordinatesPaneRenderer {
	private _data: PaneRendererCandlesticksData | null = null;

	// scaled with pixelRatio
	private _barWidth: number = 0;

	public setData(data: PaneRendererCandlesticksData): void {
		this._data = data;
	}

	protected override _drawImpl(renderingScope: BitmapCoordinatesRenderingScope): void {
		if (this._data === null || this._data.bars.length === 0 || this._data.visibleRange === null) {
			return;
		}

		const { horizontalPixelRatio } = renderingScope;

		// now we know pixelRatio and we could calculate barWidth effectively
		this._barWidth = candleWidth(this._data.barSpacing, horizontalPixelRatio);

		const bars = this._data.bars;
		if (this._data.wickVisible) {
			this._drawWicks(renderingScope, bars, this._data.visibleRange);
		}

		if (this._data.borderVisible) {
			this._drawBorder(renderingScope, bars, this._data.visibleRange);
		}

		this._drawCandles(renderingScope, bars, this._data.visibleRange);
	}

	private _barSpacingAt(bar: CandlestickItem): number {
		const data = this._data as PaneRendererCandlesticksData;
		return data.slots === null ? data.barSpacing : data.barSpacing * data.slots.width(bar.time);
	}

	private _barWidthAt(bar: CandlestickItem, horizontalPixelRatio: number): number {
		return (this._data as PaneRendererCandlesticksData).slots === null
			? this._barWidth
			: candleWidth(this._barSpacingAt(bar), horizontalPixelRatio);
	}

	private _drawWicks(renderingScope: BitmapCoordinatesRenderingScope, bars: readonly CandlestickItem[], visibleRange: SeriesItemsIndexesRange): void {
		if (this._data === null) {
			return;
		}

		const { context: ctx, horizontalPixelRatio, verticalPixelRatio } = renderingScope;

		let prevWickColor = '';
		const uniformWickWidth = wickWidthFor(this._data.barSpacing, this._barWidth, horizontalPixelRatio);
		const slots = this._data.slots;

		let prevEdge: number | null = null;

		for (let i = visibleRange.from; i < visibleRange.to; i++) {
			const bar = bars[i];
			const wickWidth = slots === null
				? uniformWickWidth
				: wickWidthFor(this._barSpacingAt(bar), this._barWidthAt(bar, horizontalPixelRatio), horizontalPixelRatio);
			const wickOffset = Math.floor(wickWidth * 0.5);
			if (bar.barWickColor !== prevWickColor) {
				ctx.fillStyle = bar.barWickColor;
				prevWickColor = bar.barWickColor;
			}

			const top = Math.round(Math.min(bar.openY, bar.closeY) * verticalPixelRatio);
			const bottom = Math.round(Math.max(bar.openY, bar.closeY) * verticalPixelRatio);

			const high = Math.round(bar.highY * verticalPixelRatio);
			const low = Math.round(bar.lowY * verticalPixelRatio);

			const scaledX = Math.round(horizontalPixelRatio * bar.x);

			let left = scaledX - wickOffset;
			const right = left + wickWidth - 1;
			if (prevEdge !== null) {
				left = Math.max(prevEdge + 1, left);
				left = Math.min(left, right);
			}
			const width = right - left + 1;

			ctx.fillRect(left, high, width, top - high);
			ctx.fillRect(left, bottom + 1, width, low - bottom);

			prevEdge = right;
		}
	}

	private _calculateBorderWidth(pixelRatio: number, barWidth: number): number {
		let borderWidth = Math.floor(Constants.BarBorderWidth * pixelRatio);
		if (barWidth <= 2 * borderWidth) {
			borderWidth = Math.floor((barWidth - 1) * 0.5);
		}
		const res = Math.max(Math.floor(pixelRatio), borderWidth);
		if (barWidth <= res * 2) {
			// do not draw bodies, restore original value
			return Math.max(Math.floor(pixelRatio), Math.floor(Constants.BarBorderWidth * pixelRatio));
		}
		return res;
	}

	private _drawBorder(renderingScope: BitmapCoordinatesRenderingScope, bars: readonly CandlestickItem[], visibleRange: SeriesItemsIndexesRange): void {
		if (this._data === null) {
			return;
		}

		const { context: ctx, horizontalPixelRatio, verticalPixelRatio } = renderingScope;

		let prevBorderColor: string | undefined = '';

		let prevEdge: number | null = null;

		for (let i = visibleRange.from; i < visibleRange.to; i++) {
			const bar = bars[i];
			const barWidth = this._barWidthAt(bar, horizontalPixelRatio);
			const borderWidth = this._calculateBorderWidth(horizontalPixelRatio, barWidth);
			if (bar.barBorderColor !== prevBorderColor) {
				ctx.fillStyle = bar.barBorderColor;
				prevBorderColor = bar.barBorderColor;
			}

			let left = Math.round(bar.x * horizontalPixelRatio) - Math.floor(barWidth * 0.5);
			// this is important to calculate right before patching left
			const right = left + barWidth - 1;

			const top = Math.round(Math.min(bar.openY, bar.closeY) * verticalPixelRatio);
			const bottom = Math.round(Math.max(bar.openY, bar.closeY) * verticalPixelRatio);

			if (prevEdge !== null) {
				left = Math.max(prevEdge + 1, left);
				left = Math.min(left, right);
			}
			if (this._barSpacingAt(bar) * horizontalPixelRatio > 2 * borderWidth) {
				fillRectInnerBorder(ctx, left, top, right - left + 1, bottom - top + 1, borderWidth);
			} else {
				const width = right - left + 1;
				ctx.fillRect(left, top, width, bottom - top + 1);
			}
			prevEdge = right;
		}
	}

	private _drawCandles(renderingScope: BitmapCoordinatesRenderingScope, bars: readonly CandlestickItem[], visibleRange: SeriesItemsIndexesRange): void {
		if (this._data === null) {
			return;
		}

		const { context: ctx, horizontalPixelRatio, verticalPixelRatio } = renderingScope;

		let prevBarColor = '';

		for (let i = visibleRange.from; i < visibleRange.to; i++) {
			const bar = bars[i];
			const barWidth = this._barWidthAt(bar, horizontalPixelRatio);
			const borderWidth = this._calculateBorderWidth(horizontalPixelRatio, barWidth);
			if (this._data.borderVisible && barWidth <= borderWidth * 2) {
				// the border already covers the whole body
				continue;
			}

			let top = Math.round(Math.min(bar.openY, bar.closeY) * verticalPixelRatio);
			let bottom = Math.round(Math.max(bar.openY, bar.closeY) * verticalPixelRatio);

			let left = Math.round(bar.x * horizontalPixelRatio) - Math.floor(barWidth * 0.5);
			let right = left + barWidth - 1;

			if (bar.barColor !== prevBarColor) {
				const barColor = bar.barColor;
				ctx.fillStyle = barColor;
				prevBarColor = barColor;
			}

			if (this._data.borderVisible) {
				left += borderWidth;
				top += borderWidth;
				right -= borderWidth;
				bottom -= borderWidth;
			}

			if (top > bottom) {
				continue;
			}
			ctx.fillRect(left, top, right - left + 1, bottom - top + 1);
		}
	}
}

/** Body width in bitmap pixels for a slot `barSpacing` CSS pixels wide. */
function candleWidth(barSpacing: number, horizontalPixelRatio: number): number {
	let barWidth = optimalCandlestickWidth(barSpacing, horizontalPixelRatio);
	// grid and crosshair have line width = Math.floor(pixelRatio)
	// if this value is odd, we have to make candlesticks' width odd
	// if this value is even, we have to make candlesticks' width even
	// in order of keeping crosshair-over-candlesticks drawing symmetric
	if (barWidth >= 2) {
		const wickWidth = Math.floor(horizontalPixelRatio);
		if ((wickWidth % 2) !== (barWidth % 2)) {
			barWidth--;
		}
	}
	return barWidth;
}

function wickWidthFor(barSpacing: number, barWidth: number, horizontalPixelRatio: number): number {
	const wickWidth = Math.min(
		Math.floor(horizontalPixelRatio),
		Math.floor(barSpacing * horizontalPixelRatio)
	);
	return Math.max(
		Math.floor(horizontalPixelRatio),
		Math.min(wickWidth, barWidth)
	);
}
