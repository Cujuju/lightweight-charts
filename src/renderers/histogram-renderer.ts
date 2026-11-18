import { BitmapCoordinatesRenderingScope } from 'fancy-canvas';

import { PricedValue } from '../model/price-scale';
import { SlotLayout } from '../model/slot-layout';
import { SeriesItemsIndexesRange, TimedValue, TimePointIndex } from '../model/time-data';

import { BitmapCoordinatesPaneRenderer } from './bitmap-coordinates-pane-renderer';

const showSpacingMinimalBarWidth = 1;
const alignToMinimalWidthLimit = 4;

export interface HistogramItem extends PricedValue, TimedValue {
	barColor: string;
}

export interface PaneRendererHistogramData {
	items: HistogramItem[];

	barSpacing: number;
	/** Relative slot widths, or `null` when every bar uses `barSpacing`. */
	slots: SlotLayout | null;
	histogramBase: number;

	visibleRange: SeriesItemsIndexesRange | null;
}

interface PrecalculatedItemCoordinates {
	left: number;
	right: number;
	roundedCenter: number;
	center: number;
	time: TimePointIndex;
}

export class PaneRendererHistogram extends BitmapCoordinatesPaneRenderer {
	private _data: PaneRendererHistogramData | null = null;
	private _precalculatedCache: PrecalculatedItemCoordinates[] = [];

	public setData(data: PaneRendererHistogramData): void {
		this._data = data;
		this._precalculatedCache = [];
	}

	protected override _drawImpl({ context: ctx, horizontalPixelRatio, verticalPixelRatio }: BitmapCoordinatesRenderingScope): void {
		if (this._data === null || this._data.items.length === 0 || this._data.visibleRange === null) {
			return;
		}
		if (!this._precalculatedCache.length) {
			this._fillPrecalculatedCache(horizontalPixelRatio);
		}

		const tickWidth = Math.max(1, Math.floor(verticalPixelRatio));
		const histogramBase = Math.round((this._data.histogramBase) * verticalPixelRatio);
		const topHistogramBase = histogramBase - Math.floor(tickWidth / 2);
		const bottomHistogramBase = topHistogramBase + tickWidth;

		for (let i = this._data.visibleRange.from; i < this._data.visibleRange.to; i++) {
			const item = this._data.items[i];
			const current = this._precalculatedCache[i - this._data.visibleRange.from];
			const y = Math.round(item.y * verticalPixelRatio);
			ctx.fillStyle = item.barColor;

			let top: number;
			let bottom: number;

			if (y <= topHistogramBase) {
				top = y;
				bottom = bottomHistogramBase;
			} else {
				top = topHistogramBase;
				bottom = y - Math.floor(tickWidth / 2) + tickWidth;
			}

			ctx.fillRect(current.left, top, current.right - current.left + 1, bottom - top);
		}
	}

	// eslint-disable-next-line complexity
	private _fillPrecalculatedCache(pixelRatio: number): void {
		if (this._data === null || this._data.items.length === 0 || this._data.visibleRange === null) {
			this._precalculatedCache = [];
			return;
		}
		const barSpacing = this._data.barSpacing;
		const slots = this._data.slots;
		const items = this._data.items;
		const spacing = gapWidth(barSpacing, pixelRatio);
		const gapAt = (index: number): number => slots === null ? spacing : gapWidth(barSpacing * slots.width(items[index].time), pixelRatio);

		this._precalculatedCache = new Array(this._data.visibleRange.to - this._data.visibleRange.from);

		for (let i = this._data.visibleRange.from; i < this._data.visibleRange.to; i++) {
			const item = items[i];
			const itemSpacing = slots === null ? barSpacing : barSpacing * slots.width(item.time);
			const columnWidth = Math.round(itemSpacing * pixelRatio) - gapAt(i);
			// force cast to avoid ensureDefined call
			const x = Math.round(item.x * pixelRatio);
			let left: number;
			let right: number;

			if (columnWidth % 2) {
				const halfWidth = (columnWidth - 1) / 2;
				left = x - halfWidth;
				right = x + halfWidth;
			} else {
				// shift pixel to left
				const halfWidth = columnWidth / 2;
				left = x - halfWidth;
				right = x + halfWidth - 1;
			}
			this._precalculatedCache[i - this._data.visibleRange.from] = {
				left,
				right,
				roundedCenter: x,
				center: (item.x * pixelRatio),
				time: item.time,
			};
		}

		// correct positions
		for (let i = this._data.visibleRange.from + 1; i < this._data.visibleRange.to; i++) {
			const current = this._precalculatedCache[i - this._data.visibleRange.from];
			const prev = this._precalculatedCache[i - this._data.visibleRange.from - 1];
			if (current.time !== prev.time + 1) {
				continue;
			}
			const gap = gapAt(i);
			if (current.left - prev.right !== (gap + 1)) {
				// have to align
				if (prev.roundedCenter > prev.center) {
					// prev wasshifted to left, so add pixel to right
					prev.right = current.left - gap - 1;
				} else {
					// extend current to left
					current.left = prev.right + gap + 1;
				}
			}
		}

		if (slots !== null) {
			// equalizing narrow columns below would erase the slot widths; only keep columns non-empty
			for (const current of this._precalculatedCache) {
				current.right = Math.max(current.right, current.left);
			}
			return;
		}

		let minWidth = Math.ceil(this._data.barSpacing * pixelRatio);
		for (let i = this._data.visibleRange.from; i < this._data.visibleRange.to; i++) {
			const current = this._precalculatedCache[i - this._data.visibleRange.from];
			// this could happen if barspacing < 1
			if (current.right < current.left) {
				current.right = current.left;
			}
			const width = current.right - current.left + 1;
			minWidth = Math.min(width, minWidth);
		}

		if (spacing > 0 && minWidth < alignToMinimalWidthLimit) {
			for (let i = this._data.visibleRange.from; i < this._data.visibleRange.to; i++) {
				const current = this._precalculatedCache[i - this._data.visibleRange.from];
				const width = current.right - current.left + 1;
				if (width > minWidth) {
					if (current.roundedCenter > current.center) {
						current.right -= 1;
					} else {
						current.left += 1;
					}
				}
			}
		}
	}
}

function gapWidth(barSpacing: number, pixelRatio: number): number {
	return Math.ceil(barSpacing * pixelRatio) <= showSpacingMinimalBarWidth ? 0 : Math.max(1, Math.floor(pixelRatio));
}
