import { BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import { ensureNotNull } from '../helpers/assertions';

import { BarCoordinates, BarPrices } from '../model/bar';
import { BarColorerStyle } from '../model/series-bar-colorer';
import { SlotLayout } from '../model/slot-layout';
import { SeriesItemsIndexesRange, TimedValue } from '../model/time-data';

import { BitmapCoordinatesPaneRenderer } from './bitmap-coordinates-pane-renderer';
import { optimalBarWidth } from './optimal-bar-width';

export type BarCandlestickItemBase = TimedValue & BarPrices & BarCoordinates;

export interface BarItem extends BarCandlestickItemBase, BarColorerStyle {
}

export interface PaneRendererBarsData {
	bars: readonly BarItem[];
	barSpacing: number;
	/** Relative slot widths, or `null` when every bar uses `barSpacing`. */
	slots: SlotLayout | null;
	openVisible: boolean;
	thinBars: boolean;

	visibleRange: SeriesItemsIndexesRange | null;
}

export class PaneRendererBars extends BitmapCoordinatesPaneRenderer {
	private _data: PaneRendererBarsData | null = null;
	private _barWidth: number = 0;
	private _barLineWidth: number = 0;
	private _drawOpenClose: boolean = false;

	public setData(data: PaneRendererBarsData): void {
		this._data = data;
	}

	protected override _drawImpl({ context: ctx, horizontalPixelRatio, verticalPixelRatio }: BitmapCoordinatesRenderingScope): void {
		if (this._data === null || this._data.bars.length === 0 || this._data.visibleRange === null) {
			return;
		}

		const slots = this._data.slots;
		this._updateBarMetrics(this._data.barSpacing, horizontalPixelRatio);
		let prevColor: string | null = null;

		for (let i = this._data.visibleRange.from; i < this._data.visibleRange.to; ++i) {
			const bar = this._data.bars[i];
			if (slots !== null) {
				this._updateBarMetrics(this._data.barSpacing * slots.width(bar.time), horizontalPixelRatio);
			}
			if (prevColor !== bar.barColor) {
				ctx.fillStyle = bar.barColor;
				prevColor = bar.barColor;
			}

			const bodyWidthHalf = Math.floor(this._barLineWidth * 0.5);

			const bodyCenter = Math.round(bar.x * horizontalPixelRatio);
			const bodyLeft = bodyCenter - bodyWidthHalf;
			const bodyWidth = this._barLineWidth;
			const bodyRight = bodyLeft + bodyWidth - 1;

			const high = Math.min(bar.highY, bar.lowY);
			const low = Math.max(bar.highY, bar.lowY);

			const bodyTop = Math.round(high * verticalPixelRatio) - bodyWidthHalf;

			const bodyBottom = Math.round(low * verticalPixelRatio) + bodyWidthHalf;

			const bodyHeight = Math.max((bodyBottom - bodyTop), this._barLineWidth);

			ctx.fillRect(
				bodyLeft,
				bodyTop,
				bodyWidth,
				bodyHeight
			);

			const sideWidth = Math.ceil(this._barWidth * 1.5);

			if (this._drawOpenClose) {
				if (this._data.openVisible) {
					const openLeft = bodyCenter - sideWidth;
					let openTop = Math.max(bodyTop, Math.round(bar.openY * verticalPixelRatio) - bodyWidthHalf);
					let openBottom = openTop + bodyWidth - 1;
					if (openBottom > bodyTop + bodyHeight - 1) {
						openBottom = bodyTop + bodyHeight - 1;
						openTop = openBottom - bodyWidth + 1;
					}
					ctx.fillRect(
						openLeft,
						openTop,
						bodyLeft - openLeft,
						openBottom - openTop + 1
					);
				}

				const closeRight = bodyCenter + sideWidth;
				let closeTop = Math.max(bodyTop, Math.round(bar.closeY * verticalPixelRatio) - bodyWidthHalf);
				let closeBottom = closeTop + bodyWidth - 1;
				if (closeBottom > bodyTop + bodyHeight - 1) {
					closeBottom = bodyTop + bodyHeight - 1;
					closeTop = closeBottom - bodyWidth + 1;
				}

				ctx.fillRect(
					bodyRight + 1,
					closeTop,
					closeRight - bodyRight,
					closeBottom - closeTop + 1
				);
			}
		}
	}

	private _updateBarMetrics(barSpacing: number, horizontalPixelRatio: number): void {
		this._barWidth = Math.max(Math.floor(horizontalPixelRatio), Math.floor(optimalBarWidth(barSpacing, horizontalPixelRatio)));

		// grid and crosshair have line width = Math.floor(pixelRatio)
		// if this value is odd, we have to make bars' width odd
		// if this value is even, we have to make bars' width even
		// in order of keeping crosshair-over-bar drawing symmetric
		if (this._barWidth >= 2) {
			const lineWidth = Math.max(1, Math.floor(horizontalPixelRatio));
			if ((lineWidth % 2) !== (this._barWidth % 2)) {
				this._barWidth--;
			}
		}

		// if scale is compressed, bar could become less than 1 CSS pixel
		this._barLineWidth = ensureNotNull(this._data).thinBars ? Math.min(this._barWidth, Math.floor(horizontalPixelRatio)) : this._barWidth;
		this._drawOpenClose = this._barLineWidth <= this._barWidth && barSpacing >= Math.floor(1.5 * horizontalPixelRatio);
	}
}
