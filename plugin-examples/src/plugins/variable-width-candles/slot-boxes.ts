import { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
	CandlestickData,
	IChartApi,
	IPrimitivePaneRenderer,
	IPrimitivePaneView,
	ISeriesApi,
	ISeriesPrimitive,
	Logical,
	SeriesAttachedParameter,
	Time,
} from 'lightweight-charts';

interface SlotBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

class SlotBoxesRenderer implements IPrimitivePaneRenderer {
	private readonly _boxes: readonly SlotBox[];
	private readonly _color: string;

	public constructor(boxes: readonly SlotBox[], color: string) {
		this._boxes = boxes;
		this._color = color;
	}

	public draw(): void {}

	public drawBackground(target: CanvasRenderingTarget2D): void {
		target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
			context.fillStyle = this._color;
			for (const box of this._boxes) {
				const left = Math.round(box.left * horizontalPixelRatio);
				const right = Math.round(box.right * horizontalPixelRatio);
				const top = Math.round(box.top * verticalPixelRatio);
				const bottom = Math.round(box.bottom * verticalPixelRatio);
				// leave one bitmap pixel between neighbouring boxes
				context.fillRect(left, top, Math.max(1, right - left - 1), Math.max(1, bottom - top));
			}
		});
	}
}

class SlotBoxesPaneView implements IPrimitivePaneView {
	private readonly _source: SlotBoxes;
	private _boxes: SlotBox[] = [];

	public constructor(source: SlotBoxes) {
		this._source = source;
	}

	public update(): void {
		this._boxes = this._source.visibleBoxes();
	}

	public renderer(): IPrimitivePaneRenderer {
		return new SlotBoxesRenderer(this._boxes, this._source.color);
	}
}

/**
 * Draws a high-low box behind every visible candle, spanning the candle's whole slot.
 * Shows how a primitive reads slot geometry with `logicalToCoordinate` and `slotWidth`.
 */
export class SlotBoxes implements ISeriesPrimitive<Time> {
	public readonly color: string;
	private readonly _paneViews: SlotBoxesPaneView[];
	private _chart: IChartApi | null = null;
	private _series: ISeriesApi<'Candlestick'> | null = null;

	public constructor(color: string = 'rgba(41, 98, 255, 0.12)') {
		this.color = color;
		this._paneViews = [new SlotBoxesPaneView(this)];
	}

	public attached(param: SeriesAttachedParameter<Time>): void {
		this._chart = param.chart as IChartApi;
		this._series = param.series as ISeriesApi<'Candlestick'>;
	}

	public detached(): void {
		this._chart = null;
		this._series = null;
	}

	public updateAllViews(): void {
		this._paneViews.forEach(view => view.update());
	}

	public paneViews(): readonly IPrimitivePaneView[] {
		return this._paneViews;
	}

	public visibleBoxes(): SlotBox[] {
		if (this._chart === null || this._series === null) {
			return [];
		}
		const timeScale = this._chart.timeScale();
		const range = timeScale.getVisibleLogicalRange();
		if (range === null) {
			return [];
		}

		const boxes: SlotBox[] = [];
		for (let logical = Math.max(0, Math.floor(range.from)); logical <= Math.ceil(range.to); logical++) {
			const bar = this._series.dataByIndex(logical) as CandlestickData<Time> | null;
			if (bar === null || bar.high === undefined) {
				continue;
			}
			const center = timeScale.logicalToCoordinate(logical as Logical);
			const width = timeScale.slotWidth(logical as Logical);
			const top = this._series.priceToCoordinate(bar.high);
			const bottom = this._series.priceToCoordinate(bar.low);
			if (center === null || width === null || top === null || bottom === null) {
				continue;
			}
			boxes.push({ left: center - width / 2, right: center + width / 2, top, bottom });
		}
		return boxes;
	}
}
