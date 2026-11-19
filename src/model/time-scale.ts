import { lowerBound } from '../helpers/algorithms';
import { ensureDefined, ensureNotNull } from '../helpers/assertions';
import { Delegate } from '../helpers/delegate';
import { ISubscription } from '../helpers/isubscription';
import { clamp } from '../helpers/mathex';
import { DeepPartial, isInteger, merge } from '../helpers/strict-type-checks';

import { ChartModel } from './chart-model';
import { Coordinate } from './coordinate';
import { FormattedLabelsCache } from './formatted-labels-cache';
import { IHorzScaleBehavior, InternalHorzScaleItem, InternalHorzScaleItemKey } from './ihorz-scale-behavior';
import { TimeRangeRequest } from './invalidate-mask';
import { LocalizationOptions } from './localization-options';
import { areRangesEqual, RangeImpl } from './range-impl';
import { defaultSlotWidth, normalizeSlotWidth, SlotLayout } from './slot-layout';
import { TickMark, TickMarks } from './tick-marks';
import {
	IRange,
	Logical,
	LogicalRange,
	SeriesItemsIndexesRange,
	TickMarkWeightValue,
	TimedValue,
	TimePointIndex,
	TimePointsRange,
	TimeScalePoint,
} from './time-data';
import { TimeScaleVisibleRange } from './time-scale-visible-range';

const defaultTickMarkMaxCharacterLength = 8;

const enum Constants {
	DefaultAnimationDuration = 400,
	// make sure that this (1 / MinVisibleBarsCount) >= coeff in max bar spacing
	MinVisibleBarsCount = 2,
}

interface ViewportIntent {
	range?: RangeImpl<TimePointIndex> | IRange<InternalHorzScaleItem> | 'fit';
	spacing?: number;
	offset?: { bars: number | undefined; pixels?: number };
}

interface TransitionState {
	barSpacing: number;
	rightOffset: number;
}

/**
 * A relative slot width for the time point at `time`.
 */
export interface InternalSlotWidth {
	time: InternalHorzScaleItem;
	width: number;
}

/**
 * Represents a tick mark on the horizontal (time) scale.
 */
export interface TimeMark {
	/** Does time mark need to be aligned */
	needAlignCoordinate: boolean;
	/** Coordinate for the time mark */
	coord: number;
	/** Display label for the time mark */
	label: string;
	/** Weight of the time mark */
	weight: TickMarkWeightValue;
}

export function markWithGreaterWeight(a: TimeMark, b: TimeMark): TimeMark {
	return a.weight > b.weight ? a : b;
}

/**
 * Options for the time scale; the horizontal scale at the bottom of the chart that displays the time of data.
 */
export interface HorzScaleOptions {
	/**
	 * The margin space in bars from the right side of the chart.
	 *
	 * @defaultValue `0`
	 */
	rightOffset: number;

	/**
	 * The margin space in pixels from the right side of the chart.
	 * This option has priority over `rightOffset`.
	 *
	 * @defaultValue `undefined`
	 */
	rightOffsetPixels?: number;

	/**
	 * The space between bars in pixels.
	 *
	 * @defaultValue `6`
	 */
	barSpacing: number;

	/**
	 * The minimum space between bars in pixels.
	 *
	 * @defaultValue `0.5`
	 */
	minBarSpacing: number;

	/**
	 * The maximum space between bars in pixels.
	 *
	 * Has no effect if value is set to `0`.
	 *
	 * @defaultValue `0`
	 */
	maxBarSpacing: number;

	/**
	 * Prevent scrolling to the left of the first bar.
	 *
	 * @defaultValue `false`
	 */
	fixLeftEdge: boolean;

	/**
	 * Prevent scrolling to the right of the most recent bar.
	 *
	 * @defaultValue `false`
	 */
	fixRightEdge: boolean;

	/**
	 * Prevent changing the visible time range during chart resizing.
	 *
	 * @defaultValue `false`
	 */
	lockVisibleTimeRangeOnResize: boolean;

	/**
	 * Prevent the hovered bar from moving when scrolling.
	 *
	 * @defaultValue `false`
	 */
	rightBarStaysOnScroll: boolean;

	/**
	 * Show the time scale border.
	 *
	 * @defaultValue `true`
	 */
	borderVisible: boolean;

	/**
	 * The time scale border color.
	 *
	 * @defaultValue `'#2B2B43'`
	 */
	borderColor: string;

	/**
	 * Show the time scale.
	 *
	 * @defaultValue `true`
	 */
	visible: boolean;

	/**
	 * Show the time, not just the date, in the time scale and vertical crosshair label.
	 *
	 * @defaultValue `false`
	 */
	timeVisible: boolean;

	/**
	 * Show seconds in the time scale and vertical crosshair label in `hh:mm:ss` format for intraday data.
	 *
	 * @defaultValue `true`
	 */
	secondsVisible: boolean;

	/**
	 * Shift the visible range to the right (into the future) by the number of new bars when new data is added.
	 *
	 * Note that this only applies when the last bar is visible.
	 *
	 * @defaultValue `true`
	 */
	shiftVisibleRangeOnNewBar: boolean;

	/**
	 * Allow the visible range to be shifted to the right when a new bar is added which
	 * is replacing an existing whitespace time point on the chart.
	 *
	 * Note that this only applies when the last bar is visible & `shiftVisibleRangeOnNewBar` is enabled.
	 *
	 * @defaultValue `false`
	 */
	allowShiftVisibleRangeOnWhitespaceReplacement: boolean;

	/**
	 * Draw small vertical line on time axis labels.
	 *
	 * @defaultValue `false`
	 */
	ticksVisible: boolean;

	/**
	 * Maximum tick mark label length. Used to override the default 8 character maximum length.
	 *
	 * @defaultValue `undefined`
	 */
	tickMarkMaxCharacterLength?: number;
	/**
	 * Changes horizontal scale marks generation.
	 * With this flag equal to `true`, marks of the same weight are either all drawn or none are drawn at all.
	 */
	uniformDistribution: boolean;

	/**
	 * Define a minimum height for the time scale.
	 * Note: This value will be exceeded if the
	 * time scale needs more space to display it's contents.
	 *
	 * Setting a minimum height could be useful for ensuring that
	 * multiple charts positioned in a horizontal stack each have
	 * an identical time scale height, or for plugins which
	 * require a bit more space within the time scale pane.
	 *
	 * @defaultValue 0
	 */
	minimumHeight: number;

	/**
	 * Allow major time scale labels to be rendered in a bolder font weight.
	 *
	 * @defaultValue true
	 */
	allowBoldLabels: boolean;

	/**
	 * Ignore time scale points containing only whitespace (for all series) when
	 * drawing grid lines, tick marks, and snapping the crosshair to time scale points.
	 *
	 * For the yield curve chart type it defaults to `true`.
	 *
	 * @defaultValue false
	 */
	ignoreWhitespaceIndices: boolean;

	/**
	 * Enable data conflation for performance optimization when bar spacing is very small.
	 * When enabled, multiple data points are automatically combined into single points
	 * when they would be rendered in less than 0.5 pixels of screen space.
	 * This significantly improves rendering performance for large datasets when zoomed out.
	 *
	 * @defaultValue false
	 */
	enableConflation: boolean;

	/**
	 * Smoothing factor for conflation thresholds. Controls how aggressively conflation is applied.
	 * This can be used to create smoother-looking charts, especially useful for sparklines and small charts.
	 *
	 * - 1.0 = conflate only when display can't show detail (default, performance-focused)
	 * - 2.0 = conflate at 2x the display threshold (moderate smoothing)
	 * - 4.0 = conflate at 4x the display threshold (strong smoothing)
	 * - 8.0+ = very aggressive smoothing for very small charts
	 *
	 * Higher values result in fewer data points being displayed, creating smoother but less detailed charts.
	 * This is particularly useful for sparklines and small charts where smooth appearance is prioritized over showing every data point.
	 *
	 * Note: Should be used with continuous series types (line, area, baseline) for best visual results.
	 * Candlestick and bar series may look less natural with high smoothing factors.
	 *
	 * @defaultValue 1.0
	 */
	conflationThresholdFactor?: number;

	/**
	 * Precompute conflation chunks for common levels right after data load.
	 * When enabled, the system will precompute conflation data in the background,
	 * which improves performance when zooming out but increases initial load time
	 * and memory usage.
	 *
	 * Performance impact:
	 * - Initial load: +100-500ms depending on dataset size
	 * - Memory usage: +20-50% of original dataset size
	 * - Zoom performance: Significant improvement (10-100x faster)
	 *
	 * Recommended for: Large datasets (\>10K points) on machines with sufficient memory
	 * @defaultValue false
	 */
	precomputeConflationOnInit: boolean;

	/**
	 * Priority used for background precompute tasks when the Prioritized Task Scheduling API is available.
	 *
	 * Options:
	 * - 'background': Lowest priority, tasks run only when the browser is idle
	 * - 'user-visible': Medium priority, tasks run when they might affect visible content
	 * - 'user-blocking': Highest priority, tasks run immediately and may block user interaction
	 *
	 * Recommendation: Use 'background' for most cases to avoid impacting user experience.
	 * Only use higher priorities if conflation is critical for your application's functionality.
	 * @defaultValue 'background'
	 */
	precomputeConflationPriority: 'background' | 'user-visible' | 'user-blocking';

}

export interface ITimeScale {
	marks(): TimeMark[] | null;
	isEmpty(): boolean;
	width(): number;
	indexToTime(index: TimePointIndex): InternalHorzScaleItem | null;
	indexToCoordinate(index: TimePointIndex): Coordinate;
	visibleStrictRange(): RangeImpl<TimePointIndex> | null;
	hasPoints(): boolean;
	timeToIndex(time: InternalHorzScaleItem, findNearest: boolean): TimePointIndex | null;

	barSpacing(): number;
	rightOffset(): number;
	kineticScrollPosition(): number;

	indexesToCoordinates<T extends TimedValue>(points: T[], visibleRange?: SeriesItemsIndexesRange): void;
	indexToTimeScalePoint(index: TimePointIndex): TimeScalePoint | null;
	formatDateTime(timeScalePoint: TimeScalePoint): string;
	coordinateToIndex(x: Coordinate): TimePointIndex;

	options(): Readonly<HorzScaleOptions>;

	recalculateIndicesWithData(): void;
	conflationFactor(): number;
	possibleConflationFactors(): number[];

	slotLayout(): SlotLayout | null;
	slotWidth(index: TimePointIndex): number;
	slotRightOffset(): number;
}

export class TimeScale<HorzScaleItem> implements ITimeScale {
	private readonly _options: HorzScaleOptions;
	private readonly _model: ChartModel<HorzScaleItem>;
	private readonly _localizationOptions: LocalizationOptions<HorzScaleItem>;

	private _width: number = 0;
	private _baseIndexOrNull: TimePointIndex | null = null;
	private _rightOffset: number;
	// With slots and a pixel default, the signed gap from the base slot to the pane edge.
	private _pixelMargin: number | undefined;
	private _points: readonly TimeScalePoint[] = [];
	private _barSpacing: number;
	private _scrollStartPoint: Coordinate | null = null;
	private _scaleStartPoint: Coordinate | null = null;
	private readonly _tickMarks: TickMarks<HorzScaleItem> = new TickMarks();
	private _formattedByWeight: Map<number, FormattedLabelsCache<HorzScaleItem>> = new Map();

	private _visibleRange: TimeScaleVisibleRange = TimeScaleVisibleRange.invalid();
	private _visibleRangeInvalidated: boolean = true;

	private readonly _visibleBarsChanged: Delegate = new Delegate();
	private readonly _logicalRangeChanged: Delegate = new Delegate();

	private readonly _optionsApplied: Delegate = new Delegate();
	private _commonTransitionStartState: TransitionState | null = null;
	private _appendCompensation: number = 0;
	private _timeMarksCache: TimeMark[] | null = null;

	private _indicesWithData: Map<TimePointIndex, boolean> = new Map();
	private _indicesWithDataUpdateId: number = -1;

	private _labels: TimeMark[] = [];

	private _conflationFactor: number = 1;

	// null while no slot width differs from the default; every conversion then uses the uniform formulas
	private _slots: SlotLayout | null = null;
	private readonly _slotWidthByKey: Map<InternalHorzScaleItemKey, number> = new Map();
	private _pendingIntent: ViewportIntent = {};
	private _awaitingSlotViewport: boolean = false;
	// logical index under the scroll start point, relative to the base index
	private _scrollAnchorFromBase: number | null = null;
	private _scrollLastPoint: Coordinate | null = null;
	private _scrollKineticAnchor: { x: Coordinate; position: number } | null = null;

	private readonly _horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>;

	public constructor(model: ChartModel<HorzScaleItem>, options: HorzScaleOptions, localizationOptions: LocalizationOptions<HorzScaleItem>, horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>) {
		this._options = options;
		this._localizationOptions = localizationOptions;
		this._rightOffset = options.rightOffset;
		this._barSpacing = options.barSpacing;
		this._model = model;
		this._checkRightOffsetPixels(options);

		this._horzScaleBehavior = horzScaleBehavior;

		this._updateDateTimeFormatter();

		this._tickMarks.setUniformDistribution(options.uniformDistribution);
		this._updateConflationFactor();
		this.recalculateIndicesWithData();
	}

	public options(): Readonly<HorzScaleOptions> {
		return this._options;
	}

	public applyLocalizationOptions(localizationOptions: DeepPartial<LocalizationOptions<HorzScaleItem>>): void {
		merge(this._localizationOptions, localizationOptions);

		this._invalidateTickMarks();
		this._updateDateTimeFormatter();
	}

	public applyOptions(options: DeepPartial<HorzScaleOptions>): void {
		merge(this._options, options);

		if (this._options.fixLeftEdge) {
			this._doFixLeftEdge();
		}

		if (this._options.fixRightEdge) {
			this._doFixRightEdge();
		}

		// note that bar spacing should be applied before right offset
		// because right offset depends on bar spacing
		if (options.barSpacing !== undefined) {
			this._model.setBarSpacing(options.barSpacing);
		}

		if (options.rightOffset !== undefined) {
			this._model.setRightOffset(options.rightOffset);
		}
		this._checkRightOffsetPixels(options);

		if ((options.minBarSpacing !== undefined || options.maxBarSpacing !== undefined) && !this._awaitingSlotViewport) {
			this._model.setBarSpacing(options.barSpacing ?? this._barSpacing, true);
		}

		if (options.ignoreWhitespaceIndices !== undefined && options.ignoreWhitespaceIndices !== this._options.ignoreWhitespaceIndices) {
			this.recalculateIndicesWithData();
		}

		this._invalidateTickMarks();
		this._updateDateTimeFormatter();
		// Recompute conflation factor when options that may affect it change
		if (options.enableConflation !== undefined || options.conflationThresholdFactor !== undefined) {
			this._updateConflationFactor();
		}
		this._optionsApplied.fire();
	}

	public indexToTime(index: TimePointIndex): InternalHorzScaleItem | null {
		return this._points[index]?.time ?? null;
	}

	public indexToTimeScalePoint(index: TimePointIndex): TimeScalePoint | null {
		return this._points[index] ?? null;
	}

	public timeToIndex(time: InternalHorzScaleItem, findNearest: boolean): TimePointIndex | null {
		if (this._points.length < 1) {
			// no time points available
			return null;
		}

		if (this._horzScaleBehavior.key(time) > this._horzScaleBehavior.key(this._points[this._points.length - 1].time)) {
			// special case
			return findNearest ? this._points.length - 1 as TimePointIndex : null;
		}

		const index = lowerBound(this._points, this._horzScaleBehavior.key(time), (a: TimeScalePoint, b: InternalHorzScaleItemKey) => this._horzScaleBehavior.key(a.time) < b);

		if (this._horzScaleBehavior.key(time) < this._horzScaleBehavior.key(this._points[index].time)) {
			return findNearest ? index as TimePointIndex : null;
		}

		return index as TimePointIndex;
	}

	public isEmpty(): boolean {
		return this._width === 0 || this._points.length === 0 || this._baseIndexOrNull === null;
	}

	public hasPoints(): boolean {
		return this._points.length > 0;
	}

	// strict range: integer indices of the bars in the visible range rounded in more wide direction
	public visibleStrictRange(): RangeImpl<TimePointIndex> | null {
		this._updateVisibleRange();
		return this._visibleRange.strictRange();
	}

	public visibleLogicalRange(): RangeImpl<Logical> | null {
		this._updateVisibleRange();
		return this._visibleRange.logicalRange();
	}

	public visibleTimeRange(): TimePointsRange | null {
		const visibleBars = this.visibleStrictRange();
		if (visibleBars === null) {
			return null;
		}

		const range: LogicalRange = {
			from: visibleBars.left() as number as Logical,
			to: visibleBars.right() as number as Logical,
		};

		return this.timeRangeForLogicalRange(range);
	}

	public timeRangeForLogicalRange(range: LogicalRange): TimePointsRange {
		const from = Math.round(range.from);
		const to = Math.round(range.to);

		const firstIndex = ensureNotNull(this._firstIndex());
		const lastIndex = ensureNotNull(this._lastIndex());

		return {
			from: ensureNotNull(this.indexToTimeScalePoint(Math.max(firstIndex, from) as TimePointIndex)),
			to: ensureNotNull(this.indexToTimeScalePoint(Math.min(lastIndex, to) as TimePointIndex)),
		};
	}

	public logicalRangeForTimeRange(range: IRange<InternalHorzScaleItem>): LogicalRange {
		return {
			from: ensureNotNull(this.timeToIndex(range.from, true)) as number as Logical,
			to: ensureNotNull(this.timeToIndex(range.to, true)) as number as Logical,
		};
	}

	public width(): number {
		return this._width;
	}

	public setWidth(newWidth: number, recalculatePanes: boolean = true): void {
		if (!isFinite(newWidth) || newWidth <= 0) {
			if (newWidth === 0 && this._slots !== null) {
				this._width = 0;
				this._visibleRangeInvalidated = true;
				this._awaitingSlotViewport = true;
			}
			return;
		}

		if (this._width === newWidth) {
			return;
		}

		// when we change the width and we need to correct visible range because of fixing left edge
		// we need to check the previous visible range rather than the new one
		// because it might be updated by changing width, bar spacing, etc
		// but we need to try to keep the same range
		const previousVisibleRange = this.visibleLogicalRange();

		const oldWidth = this._width;
		const oldBarSpacing = this._barSpacing;
		const lockRange = this._options.lockVisibleTimeRangeOnResize && oldWidth !== 0;
		this._width = newWidth;
		this._visibleRangeInvalidated = true;

		if (lockRange) {
			// recalculate bar spacing
			const newBarSpacing = this._barSpacing * newWidth / oldWidth;
			this._barSpacing = newBarSpacing;
		}

		this._constrainResize(previousVisibleRange, oldWidth, oldBarSpacing, lockRange);
		if (oldWidth === 0 && this._applyPendingIntent(recalculatePanes)) {
			return;
		}
		this._correctOffset();
	}

	public indexToCoordinate(index: TimePointIndex): Coordinate {
		if (this.isEmpty() || !isInteger(index)) {
			return 0 as Coordinate;
		}

		if (this._slots !== null) {
			return this._slotToCoordinate(this._slots.center(index), this._rightEdgeSlot(this._slots));
		}

		const baseIndex = this.baseIndex();
		const deltaFromRight = baseIndex + this._rightOffset - index;
		const coordinate = this._width - (deltaFromRight + 0.5) * this._barSpacing - 1;
		return coordinate as Coordinate;
	}

	public indexesToCoordinates<T extends TimedValue>(points: T[], visibleRange?: SeriesItemsIndexesRange): void {
		const baseIndex = this.baseIndex();
		const indexFrom = (visibleRange === undefined) ? 0 : visibleRange.from;
		const indexTo = (visibleRange === undefined) ? points.length : visibleRange.to;

		const slots = this._slots;
		if (slots !== null) {
			const rightEdgeSlot = this._rightEdgeSlot(slots);
			for (let i = indexFrom; i < indexTo; i++) {
				points[i].x = this._slotToCoordinate(slots.center(points[i].time), rightEdgeSlot);
			}
			return;
		}

		for (let i = indexFrom; i < indexTo; i++) {
			const index = points[i].time;
			const deltaFromRight = baseIndex + this._rightOffset - index;
			const coordinate = this._width - (deltaFromRight + 0.5) * this._barSpacing - 1;
			points[i].x = coordinate as Coordinate;
		}
	}

	public coordinateToIndex(x: Coordinate, considerIgnoreWhitespace?: boolean): TimePointIndex {
		const index = Math.ceil(this._coordinateToFloatIndex(x)) as TimePointIndex;
		if (
			!considerIgnoreWhitespace ||
			!this._options.ignoreWhitespaceIndices ||
			this._shouldConsiderIndex(index)
		) {
			return index;
		}
		return this._slots === null
			? this._findNearestIndexWithData(index)
			: this._findNearestSlotWithData(index, x);
	}

	public setRightOffset(offset: number | undefined, offsetPixels?: number): void {
		if (this._width === 0) {
			this._pendingIntent.offset = { bars: offset, pixels: offsetPixels };
			if (this._awaitingSlotViewport) {
				return;
			}
		}
		this._applyRightOffset(offset, offsetPixels);
		this._correctOffset();
		this._recalculateViewport();
	}

	/**
	 * Samples pointer movement during a variable-width drag and compensated offset movement during a uniform drag.
	 */
	public kineticScrollPosition(): number {
		if (this._scrollKineticAnchor !== null) {
			const { x, position } = this._scrollKineticAnchor;
			return position + (x - ensureNotNull(this._scrollLastPoint)) / ensureNotNull(this._commonTransitionStartState).barSpacing;
		}
		return this.slotRightOffset() + this._appendCompensation;
	}

	/**
	 * The right offset measured in default-width slots, i.e. in pixels divided by bar spacing.
	 * Equal to `rightOffset()` without slot widths. Kinetic and animated scrolling run in this unit.
	 */
	public slotRightOffset(): number {
		return this._pixelMargin === undefined
			? this._slotRightOffsetFor(this._rightOffset, this.baseIndex())
			: this._pixelMargin / this._barSpacing;
	}

	public setSlotRightOffset(slotOffset: number): void {
		this.setRightOffset(this._rightOffsetForSlotOffset(slotOffset));
	}

	public slotLayout(): SlotLayout | null {
		return this._slots;
	}

	/** Width in pixels of the slot at `index`. */
	public slotWidth(index: TimePointIndex): number {
		return this._slots === null ? this._barSpacing : this._barSpacing * this._slots.width(index);
	}

	/** Replaces every stored slot width. */
	public setSlotWidths(widths: readonly InternalSlotWidth[]): void {
		this._storeSlotWidths(widths, true);
	}

	/** Adds or replaces the slot widths for the given times, keeping all others. */
	public updateSlotWidths(widths: readonly InternalSlotWidth[]): void {
		this._storeSlotWidths(widths, false);
	}

	public barSpacing(): number {
		return this._barSpacing;
	}

	public setBarSpacing(newBarSpacing: number, revalidate: boolean = false): void {
		if (this._width === 0) {
			if (!revalidate) {
				this._pendingIntent.spacing = newBarSpacing;
			}
			if (this._awaitingSlotViewport) {
				return;
			}
		}
		this._applyBarSpacing(revalidate && this._slots !== null ? this._barSpacing : newBarSpacing);
		this._correctOffset();
		this._recalculateViewport();
	}

	public rightOffset(): number {
		return this._pixelMargin === undefined ? this._rightOffset : this._rightOffsetForSlotOffset(this.slotRightOffset());
	}

	// eslint-disable-next-line complexity
	public marks(): TimeMark[] | null {
		if (this.isEmpty()) {
			return null;
		}

		if (this._timeMarksCache !== null) {
			return this._timeMarksCache;
		}

		const spacing = this._barSpacing;
		const fontSize = this._model.options()['layout'].fontSize;

		const pixelsPer8Characters = (fontSize + 4) * 5;
		const pixelsPerCharacter = pixelsPer8Characters / defaultTickMarkMaxCharacterLength;
		const maxLabelWidth = pixelsPerCharacter * (this._options.tickMarkMaxCharacterLength || defaultTickMarkMaxCharacterLength);
		const indexPerLabel = Math.round(maxLabelWidth / spacing);

		const visibleBars = ensureNotNull(this.visibleStrictRange());

		const firstBar = Math.max(visibleBars.left(), visibleBars.left() - indexPerLabel);
		const lastBar = Math.max(visibleBars.right(), visibleBars.right() - indexPerLabel);

		const items = this._tickMarks.build(
			spacing,
			maxLabelWidth,
			this._options.ignoreWhitespaceIndices,
			this._indicesWithData,
			this._indicesWithDataUpdateId,
			this._slots
		);

		// according to indexPerLabel value this value means "earliest index which _might be_ used as the second label on time scale"
		const earliestIndexOfSecondLabel = (this._firstIndex() as number) + indexPerLabel;

		// according to indexPerLabel value this value means "earliest index which _might be_ used as the second last label on time scale"
		const indexOfSecondLastLabel = (this._lastIndex() as number) - indexPerLabel;

		const isAllScalingAndScrollingDisabled = this._isAllScalingAndScrollingDisabled();
		const isLeftEdgeFixed = this._options.fixLeftEdge || isAllScalingAndScrollingDisabled;
		const isRightEdgeFixed = this._options.fixRightEdge || isAllScalingAndScrollingDisabled;

		let targetIndex = 0;
		for (const tm of items) {
			if (!(firstBar <= tm.index && tm.index <= lastBar)) {
				continue;
			}

			let label: TimeMark;
			if (targetIndex < this._labels.length) {
				label = this._labels[targetIndex];
				label.coord = this.indexToCoordinate(tm.index);
				label.label = this._formatLabel(tm);
				label.weight = tm.weight;
			} else {
				label = {
					needAlignCoordinate: false,
					coord: this.indexToCoordinate(tm.index),
					label: this._formatLabel(tm),
					weight: tm.weight,
				};

				this._labels.push(label);
			}

			if (this._barSpacing > (maxLabelWidth / 2) && !isAllScalingAndScrollingDisabled) {
				// if there is enough space then let's show all tick marks as usual
				label.needAlignCoordinate = false;
			} else {
				// if a user is able to scroll after a tick mark then show it as usual, otherwise the coordinate might be aligned
				// if the index is for the second (last) label or later (earlier) then most likely this label might be displayed without correcting the coordinate
				label.needAlignCoordinate = (isLeftEdgeFixed && tm.index <= earliestIndexOfSecondLabel) || (isRightEdgeFixed && tm.index >= indexOfSecondLastLabel);
			}

			targetIndex++;
		}
		this._labels.length = targetIndex;

		this._timeMarksCache = this._labels;

		return this._labels;
	}

	public restoreDefault(): void {
		this._visibleRangeInvalidated = true;
		this._pendingIntent.range = undefined;

		this.setBarSpacing(this._options.barSpacing);

		const pixelOffset = this._options.rightOffsetPixels;
		const offset = pixelOffset !== undefined && this._slots === null
			? pixelOffset / this.barSpacing()
			: this._options.rightOffset;
		this.setRightOffset(offset, pixelOffset);
	}

	public setBaseIndex(baseIndex: TimePointIndex | null, appendDelta: number = 0): number {
		this._visibleRangeInvalidated = true;
		this._baseIndexOrNull = baseIndex;
		if (this._slots !== null) {
			this._setBarSpacing(this._barSpacing);
			if (appendDelta !== 0) {
				return this._shiftRightOffset(appendDelta);
			}
		}
		this._correctOffset();
		if (this._slots === null) {
			this._doFixLeftEdge();
		}
		return appendDelta === 0 ? 0 : this._shiftRightOffset(appendDelta);
	}

	/**
	 * Zoom in/out the scale around a `zoomPoint` on `scale` value.
	 *
	 * @param zoomPoint - X coordinate of the point to apply the zoom.
	 * If `rightBarStaysOnScroll` option is disabled, then will be used to restore right offset.
	 * @param scale - Zoom value (in 1/10 parts of current bar spacing).
	 * Negative value means zoom out, positive - zoom in.
	 */
	public zoom(zoomPoint: Coordinate, scale: number): void {
		const floatIndexAtZoomPoint = this._coordinateToFloatIndex(zoomPoint);
		const logicalAtZoomPoint = this._logicalAt(zoomPoint);

		const barSpacing = this.barSpacing();
		const newBarSpacing = barSpacing + scale * (barSpacing / 10);

		// zoom in/out bar spacing
		this.setBarSpacing(newBarSpacing);

		if (!this._options.rightBarStaysOnScroll) {
			// and then correct right offset to move index under zoomPoint back to its coordinate
			this.setRightOffset(this._slots === null
				? this.rightOffset() + (floatIndexAtZoomPoint - this._coordinateToFloatIndex(zoomPoint))
				: this._rightOffsetPlacing(this._slots, logicalAtZoomPoint, zoomPoint)
			);
		}
	}

	public startScale(x: Coordinate): void {
		if (this._scrollStartPoint) {
			this.endScroll();
		}

		if (this._scaleStartPoint !== null || this._commonTransitionStartState !== null) {
			return;
		}

		if (this.isEmpty()) {
			return;
		}

		this._scaleStartPoint = x;
		this._saveCommonTransitionsStartState();
	}

	public scaleTo(x: Coordinate): void {
		if (this._commonTransitionStartState === null) {
			return;
		}

		const startLengthFromRight = clamp(this._width - x, 0, this._width);
		const currentLengthFromRight = clamp(this._width - ensureNotNull(this._scaleStartPoint), 0, this._width);
		if (startLengthFromRight === 0 || currentLengthFromRight === 0) {
			return;
		}

		this.setBarSpacing(
			this._commonTransitionStartState.barSpacing * startLengthFromRight / currentLengthFromRight
		);
	}

	public endScale(): void {
		if (this._scaleStartPoint === null) {
			return;
		}

		this._scaleStartPoint = null;
		this._clearCommonTransitionsStartState();
	}

	public startScroll(x: Coordinate): void {
		if (this._scrollStartPoint !== null || this._commonTransitionStartState !== null) {
			return;
		}

		if (this.isEmpty()) {
			return;
		}

		this._scrollStartPoint = x;
		this._scrollLastPoint = x;
		this._scrollAnchorFromBase = this._logicalAt(x) - this.baseIndex();
		this._saveCommonTransitionsStartState();
		if (this._slots !== null) {
			this._captureScrollKineticAnchor();
		}
	}

	public scrollTo(x: Coordinate): void {
		if (this._scrollStartPoint === null) {
			return;
		}

		this._scrollLastPoint = x;
		if (this._slots !== null) {
			// keep the point grabbed at scroll start under the pointer
			this._setLogicalOffset(this._rightOffsetPlacing(this._slots, this.baseIndex() + ensureNotNull(this._scrollAnchorFromBase), x));
		} else if (this._scrollKineticAnchor !== null) {
			this._rightOffset = ensureNotNull(this._scrollAnchorFromBase) + this._rightOffsetForCoordinate(x) - 0.5;
		} else {
			const shiftInLogical = (this._scrollStartPoint - x) / this.barSpacing();
			this._rightOffset = ensureNotNull(this._commonTransitionStartState).rightOffset + shiftInLogical;
		}
		this._visibleRangeInvalidated = true;

		// do not allow scroll out of visible bars
		this._correctOffset();
	}

	public endScroll(): void {
		if (this._scrollStartPoint === null) {
			return;
		}

		this._scrollStartPoint = null;
		this._scrollLastPoint = null;
		this._scrollKineticAnchor = null;
		this._scrollAnchorFromBase = null;
		this._clearCommonTransitionsStartState();
	}

	public scrollToRealTime(): void {
		this.scrollToOffsetAnimated(this._options.rightOffset, Constants.DefaultAnimationDuration, this._options.rightOffsetPixels);
	}

	public scrollToOffsetAnimated(offset: number, animationDuration: number = Constants.DefaultAnimationDuration, offsetPixels?: number): void {
		if (!isFinite(offset)) {
			throw new RangeError('offset is required and must be finite number');
		}

		if (!isFinite(animationDuration) || animationDuration <= 0) {
			throw new RangeError('animationDuration (optional) must be finite positive number');
		}

		// animate in slot units so the speed in pixels is uniform
		let source = this.slotRightOffset();
		const animationStart = performance.now();
		let segmentStart = animationStart;
		let lastFrameTime = animationStart;
		let slots = this._slots;
		let revision = slots?.revision();
		const segmentProgress = (time: number): number => (time - segmentStart) / (animationDuration - (segmentStart - animationStart));

		this._model.setTimeScaleAnimation({
			finished: (time: number) => (time - animationStart) / animationDuration >= 1,
			getPosition: (time: number) => {
				const target = this._slots !== null && offsetPixels !== undefined
					? offsetPixels / this._barSpacing
					: this._slotRightOffsetFor(offset, this.baseIndex());
				if ((time - animationStart) / animationDuration >= 1) {
					return target;
				}
				if (slots !== this._slots || revision !== this._slots?.revision()) {
					slots = this._slots;
					revision = slots?.revision();
					source = this.slotRightOffset();
					segmentStart = lastFrameTime;
				}
				lastFrameTime = Math.max(animationStart, time);
				// the first frame's timestamp can be earlier than the animation start, so don't move backwards
				return source + (target - source) * Math.max(0, segmentProgress(time));
			},
			shift: (delta: number) => {
				const progress = segmentProgress(performance.now());
				if (progress < 1) {
					source -= delta / (1 - progress);
				}
			},
		});
	}

	public update(newPoints: readonly TimeScalePoint[], firstChangedPointIndex: number, baseUpdateFollows: boolean = false): void {
		this._visibleRangeInvalidated = true;

		this._points = newPoints;
		this._tickMarks.setTimeScalePoints(newPoints, firstChangedPointIndex);
		this._syncSlotLayout(firstChangedPointIndex);
		if (!baseUpdateFollows || this._slots === null) {
			if (this._slots !== null) {
				this._setBarSpacing(this._barSpacing);
			}
			this._correctOffset();
		}
	}

	public visibleBarsChanged(): ISubscription {
		return this._visibleBarsChanged;
	}

	public logicalRangeChanged(): ISubscription {
		return this._logicalRangeChanged;
	}

	public optionsApplied(): ISubscription {
		return this._optionsApplied;
	}

	public baseIndex(): TimePointIndex {
		// null is used to known that baseIndex is not set yet
		// so in methods which should known whether it is set or not
		// we should check field `_baseIndexOrNull` instead of getter `baseIndex()`
		// see minRightOffset for example
		return this._baseIndexOrNull || 0 as TimePointIndex;
	}

	public setVisibleRange(range: RangeImpl<TimePointIndex>, timeRange?: TimeRangeRequest): void {
		if (this._recordRange(timeRange?.range ?? range)) {
			return;
		}
		const resolveTime = timeRange?.requestedWhileUnsized && this._width > 0 && this._slots !== null && this.hasPoints();
		this._applyVisibleRange(resolveTime ? this._barRange(this.logicalRangeForTimeRange(timeRange.range)) : range);
		this._correctOffset();
		this._recalculateViewport();
	}

	public fitContent(): void {
		if (!this._recordRange('fit') && this._fitContent()) {
			this._correctOffset();
			this._recalculateViewport();
		}
	}

	public setLogicalRange(range: LogicalRange, timeRange?: TimeRangeRequest): void {
		this.setVisibleRange(this._barRange(range), timeRange);
	}

	public formatDateTime(timeScalePoint: TimeScalePoint): string {
		if (this._localizationOptions.timeFormatter != null) {
			return this._localizationOptions.timeFormatter(timeScalePoint.originalTime as HorzScaleItem);
		}

		return this._horzScaleBehavior.formatHorzItem(timeScalePoint.time);
	}

	public recalculateIndicesWithData(): void {
		if (!this._options.ignoreWhitespaceIndices) {
			return;
		}
		this._indicesWithData.clear();
		const series = this._model.serieses();
		for (const s of series) {
			for (const index of s.fulfilledIndices()) {
				this._indicesWithData.set(index, true);
			}
		}
		this._indicesWithDataUpdateId++;
	}

	/**
	 * Returns the current data conflation factor.
	 * Factor \> 1 means data points should be conflated for performance.
	 */
	public conflationFactor(): number {
		return this._conflationFactor;
	}

	/**
	 * Provides an array of possible conflations factors based on the current
	 * minBarSpacing setting for the chart.
	 * @returns Arrays of conflation factors (number of bars to merge)
	 */
	public possibleConflationFactors(): number[] {
		const devicePixelRatio = window.devicePixelRatio || 1;
		const conflationThreshold = 1.0 / devicePixelRatio;
		const minBarSpacing = this._options.minBarSpacing;

		if (minBarSpacing >= conflationThreshold) {
			return [1];
		}

		// Return all power-of-2 conflation levels that might be used
		const factors = [1];
		let currentLevel = 2;
		const maxLevel = 512;

		while (currentLevel <= maxLevel) {
			const levelThreshold = conflationThreshold / currentLevel;
			if (minBarSpacing < levelThreshold) {
				factors.push(currentLevel);
			}
			currentLevel *= 2;
		}

		return factors;
	}

	private _isAllScalingAndScrollingDisabled(): boolean {
		const handleScroll = this._model.options()['handleScroll'];
		const handleScale = this._model.options()['handleScale'];
		return !handleScroll.horzTouchDrag
			&& !handleScroll.mouseWheel
			&& !handleScroll.pressedMouseMove
			&& !handleScroll.vertTouchDrag
			&& !handleScale.axisDoubleClickReset.time
			&& !handleScale.axisPressedMouseMove.time
			&& !handleScale.mouseWheel
			&& !handleScale.pinch;
	}

	private _firstIndex(): TimePointIndex | null {
		return this._points.length === 0 ? null : 0 as TimePointIndex;
	}

	private _lastIndex(): TimePointIndex | null {
		return this._points.length === 0 ? null : (this._points.length - 1) as TimePointIndex;
	}

	private _rightOffsetForCoordinate(x: Coordinate): number {
		return (this._width - 1 - x) / this._barSpacing;
	}

	private _coordinateToFloatIndex(x: Coordinate): number {
		const deltaFromRight = this._rightOffsetForCoordinate(x);
		// bar i spans float indices (i - 1, i], so ceil() finds the bar under x
		const index = this._slots === null
			? this.baseIndex() + this._rightOffset - deltaFromRight
			: this._logicalAt(x) - 0.5;

		// JavaScript uses very strange rounding
		// we need rounding to avoid problems with calculation errors
		return Math.round(index * 1000000) / 1000000;
	}

	/** Slot-unit position of the right edge of the pane. */
	private _rightEdgeSlot(slots: SlotLayout): number {
		return this._pixelMargin === undefined
			? slots.logicalToSlot(this.baseIndex() + this._rightOffset + 0.5)
			: slots.start(this.baseIndex() + 1) + this.slotRightOffset();
	}

	/** Unrounded logical index at `x`; bar `i` spans `i - 0.5 .. i + 0.5`. */
	private _logicalAt(x: Coordinate): number {
		const deltaFromRight = this._rightOffsetForCoordinate(x);
		return this._slots === null
			? this.baseIndex() + this._rightOffset + 0.5 - deltaFromRight
			: this._slots.slotToLogical(this._rightEdgeSlot(this._slots) - deltaFromRight);
	}

	private _slotToCoordinate(slot: number, rightEdgeSlot: number): Coordinate {
		return this._width - 1 - (rightEdgeSlot - slot) * this._barSpacing as Coordinate;
	}

	/** The right offset that puts the float `logical` index at coordinate `x`. */
	private _rightOffsetPlacing(slots: SlotLayout, logical: number, x: Coordinate): number {
		const rightEdgeSlot = slots.logicalToSlot(logical) + this._rightOffsetForCoordinate(x);
		return slots.slotToLogical(rightEdgeSlot) - 0.5 - this.baseIndex();
	}

	private _slotRightOffsetFor(rightOffset: number, baseIndex: number): number {
		return this._slots === null
			? rightOffset
			: this._slots.logicalToSlot(baseIndex + rightOffset + 0.5) - this._slots.logicalToSlot(baseIndex + 0.5);
	}

	private _rightOffsetForSlotOffset(slotOffset: number): number {
		if (this._slots === null) {
			return slotOffset;
		}
		const baseIndex = this.baseIndex();
		const rightEdgeSlot = this._slots.start(baseIndex + 1) + slotOffset;
		return this._slots.slotToLogical(rightEdgeSlot) - 0.5 - baseIndex;
	}

	/** Compensates for an advancing base when the viewport stays put. */
	private _shiftRightOffset(delta: number): number {
		if (this._commonTransitionStartState !== null) {
			this._commonTransitionStartState.rightOffset -= delta;
		}
		if (this._scrollAnchorFromBase !== null) {
			this._scrollAnchorFromBase -= delta;
		}

		const base = this.baseIndex();
		const previousBase = base - delta;
		const slots = this._slots;
		const slotShift = slots === null ? delta : slots.start(base + 1) - slots.start(previousBase + 1);
		const before = this._pixelMargin === undefined
			? this._slotRightOffsetFor(this._rightOffset, previousBase)
			: this.slotRightOffset();
		if (this._pixelMargin === undefined) {
			this._setLogicalOffset(this._rightOffset - delta);
		} else {
			this._pixelMargin -= slotShift * this._barSpacing;
		}
		this._visibleRangeInvalidated = true;
		this._correctOffset();
		this._recalculateViewport();
		this._appendCompensation += before - this.slotRightOffset();
		return slotShift;
	}

	private _captureScrollKineticAnchor(): void {
		if (this._scrollLastPoint !== null && this._scrollKineticAnchor === null) {
			this._scrollKineticAnchor = { x: this._scrollLastPoint, position: this.kineticScrollPosition() };
		}
	}

	private _recordRange(range: ViewportIntent['range']): boolean {
		if (this._width !== 0) {
			return false;
		}
		this._pendingIntent = { range };
		return this._awaitingSlotViewport;
	}

	private _barRange(range: LogicalRange): RangeImpl<TimePointIndex> {
		return new RangeImpl(range.from as number as TimePointIndex, range.to as number as TimePointIndex);
	}

	private _constrainResize(previousRange: RangeImpl<Logical> | null, oldWidth: number, oldSpacing: number, lockRange: boolean): void {
		const fixLeft = this._options.fixLeftEdge && previousRange !== null && previousRange.left() <= 0;
		if (fixLeft && this._slots === null) {
			// Preserve upstream's uniform left-edge correction.
			this._rightOffset -= Math.round((oldWidth - this._width) / this._barSpacing) + 1;
		}
		this._correctBarSpacing();
		if (lockRange && this._pixelMargin !== undefined) {
			// Keep the right edge in the same slot units at the new spacing.
			this._pixelMargin *= this._barSpacing / oldSpacing;
		}
		if (fixLeft && this._slots !== null && (!lockRange || this._pixelMargin === undefined)) {
			this._setLogicalOffset(ensureNotNull(this._minRightOffset()));
		}
	}

	private _applyPendingIntent(recalculatePanes: boolean): boolean {
		const { range, spacing, offset } = this._pendingIntent;
		this._pendingIntent = {};
		if (!this._awaitingSlotViewport) {
			return false;
		}
		this._awaitingSlotViewport = false;
		const appliedRange = range === 'fit'
			? this._fitContent(spacing)
			: range instanceof RangeImpl
				? this._applyVisibleRange(range, false, spacing)
				: range !== undefined && this.hasPoints() && this._applyVisibleRange(this._barRange(this.logicalRangeForTimeRange(range)), false, spacing);
		if (!appliedRange && spacing !== undefined) {
			this._applyBarSpacing(spacing);
		}
		if (offset !== undefined) {
			this._applyRightOffset(offset.bars, offset.pixels, true);
		}
		this._correctOffset();
		if (recalculatePanes && (appliedRange || spacing !== undefined || offset !== undefined)) {
			this._recalculateViewport();
		}
		return true;
	}

	private _applyRightOffset(bars: number | undefined, pixels?: number, resolvePixels: boolean = false): void {
		if (this._slots !== null && pixels !== undefined) {
			this._pixelMargin = pixels;
		} else if (pixels !== undefined && (resolvePixels || bars === undefined)) {
			this._setLogicalOffset(pixels / this._barSpacing);
		} else {
			this._setLogicalOffset(ensureDefined(bars));
		}
		this._visibleRangeInvalidated = true;
	}

	private _setLogicalOffset(offset: number): void {
		if (this._slots !== null && (this._options.rightOffsetPixels !== undefined || this._pixelMargin !== undefined)) {
			this._pixelMargin = this._slotRightOffsetFor(offset, this.baseIndex()) * this._barSpacing;
		} else {
			this._rightOffset = offset;
		}
	}

	private _applyBarSpacing(newBarSpacing: number): void {
		const oldBarSpacing = this._barSpacing;
		this._setBarSpacing(newBarSpacing);
		if (this._slots === null && this._options.rightOffsetPixels !== undefined && oldBarSpacing !== 0) {
			this._rightOffset = this._rightOffset * oldBarSpacing / this._barSpacing;
		}
	}

	private _fitContent(spacing?: number): boolean {
		const first = this._firstIndex();
		const last = this._lastIndex();
		if (first === null || last === null) {
			return false;
		}
		if (this._slots !== null && this._options.fixRightEdge) {
			return this._applyVisibleRange(new RangeImpl(first, this._fixedRightIndex(last)), false, spacing);
		}
		const pixels = this._options.rightOffsetPixels;
		const usePixels = this._slots === null ? !!pixels : pixels !== undefined;
		const extraBars = usePixels ? 0 : this._options.rightOffset || 0;
		return this._applyVisibleRange(new RangeImpl(first, last + extraBars as TimePointIndex), true, spacing);
	}

	private _applyVisibleRange(range: RangeImpl<TimePointIndex>, applyDefaultOffset: boolean = false, spacing?: number): boolean {
		const length = this._slots === null
			? range.count()
			: this._slots.logicalToSlot(range.right() + 0.5) - this._slots.logicalToSlot(range.left() - 0.5);
		const pixels = applyDefaultOffset ? this._options.rightOffsetPixels : undefined;
		this._setBarSpacing(spacing ?? (this._width - (pixels || 0)) / length);
		const bars = applyDefaultOffset ? this._options.rightOffset : range.right() - this.baseIndex();
		this._applyRightOffset(this._slots === null && pixels ? pixels / this._barSpacing : bars, pixels);
		return true;
	}

	private _recalculateViewport(): void {
		this._model.recalculateAllPanes();
		this._model.lightUpdate();
	}

	private _storeSlotWidths(widths: readonly InternalSlotWidth[], replaceAll: boolean): void {
		// validate everything first so a bad entry leaves the stored widths untouched
		const normalized = widths.map((entry: InternalSlotWidth) => normalizeSlotWidth(entry.width));
		if (replaceAll) {
			this._slotWidthByKey.clear();
		}

		let firstChangedIndex = replaceAll ? 0 : this._points.length;
		for (let i = 0; i < widths.length; i++) {
			const key = this._horzScaleBehavior.key(widths[i].time);
			if (normalized[i] === defaultSlotWidth) {
				this._slotWidthByKey.delete(key);
			} else {
				this._slotWidthByKey.set(key, normalized[i]);
			}
			const index = replaceAll ? null : this.timeToIndex(widths[i].time, false);
			if (index !== null) {
				firstChangedIndex = Math.min(firstChangedIndex, index);
			}
		}

		this._syncSlotLayout(firstChangedIndex);
		if (this._slots !== null) {
			this._setBarSpacing(this._barSpacing);
		}
		this._visibleRangeInvalidated = true;
		this._resetTimeMarksCache();
		this._correctOffset();
		this._recalculateViewport();
	}

	private _syncSlotLayout(firstChangedIndex: number): void {
		if (this._slotWidthByKey.size === 0) {
			if (this._slots !== null) {
				this._slots = null;
				if (this._width > 0) {
					this._setBarSpacing(this._barSpacing);
				}
				this._rightOffset = this.rightOffset();
				this._pixelMargin = undefined;
			}
			return;
		}
		if (this._slots === null) {
			this._captureScrollKineticAnchor();
			this._slots = new SlotLayout();
			firstChangedIndex = 0;
			this._awaitingSlotViewport ||= this._width === 0;
			if (this._width > 0 && this._options.rightOffsetPixels !== undefined) {
				this._pixelMargin = this._rightOffset * this._barSpacing;
			}
		}
		this._slots.update(this._points.length, firstChangedIndex, (index: number) =>
			this._slotWidthByKey.get(this._horzScaleBehavior.key(this._points[index].time)) ?? defaultSlotWidth
		);
	}

	private _setBarSpacing(newBarSpacing: number): void {
		const oldBarSpacing = this._barSpacing;
		this._barSpacing = newBarSpacing;
		this._correctBarSpacing();

		// this._barSpacing might be changed in _correctBarSpacing
		if (oldBarSpacing !== this._barSpacing) {
			this._visibleRangeInvalidated = true;
			this._resetTimeMarksCache();
			this._updateConflationFactor();
		}
	}

	private _updateVisibleRange(): void {
		if (!this._visibleRangeInvalidated) {
			return;
		}

		this._visibleRangeInvalidated = false;

		if (this.isEmpty()) {
			this._setVisibleRange(TimeScaleVisibleRange.invalid());
			return;
		}

		const newBarsLength = this._width / this._barSpacing;
		let rightBorder = this._rightOffset + this.baseIndex();
		let leftBorder = rightBorder - newBarsLength + 1;
		if (this._slots !== null) {
			const rightEdge = this._rightEdgeSlot(this._slots);
			leftBorder = this._slots.slotToLogical(rightEdge - newBarsLength) + 0.5;
			rightBorder = this._slots.slotToLogical(rightEdge) - 0.5;
			if (leftBorder > rightBorder) {
				// A viewport less than one logical slot wide still includes the slots it intersects.
				leftBorder = Math.floor(leftBorder);
				rightBorder = Math.ceil(rightBorder);
			}
		}

		const logicalRange = new RangeImpl(leftBorder as Logical, rightBorder as Logical);
		this._setVisibleRange(new TimeScaleVisibleRange(logicalRange));
	}

	private _correctBarSpacing(): void {
		if (this._slots !== null && this._width === 0) {
			return;
		}
		const minSpacing = this._minBarSpacing();
		const barSpacing = clamp(this._barSpacing, minSpacing, this._maxBarSpacing(minSpacing));
		if (this._barSpacing !== barSpacing) {
			this._barSpacing = barSpacing;
			this._visibleRangeInvalidated = true;
		}
	}

	private _maxBarSpacing(minSpacing: number): number {
		if (this._options.maxBarSpacing > 0) {
			return this._options.maxBarSpacing;
		}
		const defaultMaxSpacing = this._width * 0.5;
		return this._slots !== null && this._options.fixLeftEdge && this._options.fixRightEdge
			? Math.max(minSpacing, defaultMaxSpacing)
			: defaultMaxSpacing;
	}

	private _minBarSpacing(): number {
		// if both options are enabled then limit bar spacing so that zooming-out is not possible
		// if it would cause either the first or last points to move too far from an edge
		if (this._options.fixLeftEdge && this._options.fixRightEdge && this._points.length !== 0) {
			const length = this._slots === null
				? this._points.length
				: this._slots.start(this._fixedRightIndex(this._points.length - 1 as TimePointIndex) + 1);
			return this._width / length;
		}

		return this._options.minBarSpacing;
	}

	private _fixedRightIndex(lastIndex: TimePointIndex): TimePointIndex {
		return Math.min(lastIndex, this._baseIndexOrNull ?? lastIndex) as TimePointIndex;
	}

	/**
	 * Updates the conflation factor based on current bar spacing using DPR-aware power-of-2 calculation with optional smoothing factor.
	 * The smoothing factor allows intentional over-conflation for smoother appearance in small charts and sparklines.
	 */
	private _updateConflationFactor(): void {
		if (!this._options.enableConflation) {
			this._conflationFactor = 1;
			return;
		}

		// Use DPR-aware threshold calculation with smoothing factor
		const devicePixelRatio = window.devicePixelRatio || 1;
		const smoothingFactor = this._options.conflationThresholdFactor ?? 1;
		const adjustedThreshold = (1.0 / devicePixelRatio) * smoothingFactor;

		if (this._barSpacing >= adjustedThreshold) {
			this._conflationFactor = 1;
			return;
		}

		// Calculate conflation level as power of 2
		const ratio = adjustedThreshold / this._barSpacing;
		const conflationLevel = Math.pow(2, Math.floor(Math.log2(ratio)));

		// Ensure we don't exceed maximum conflation level (512)
		this._conflationFactor = Math.min(conflationLevel, 512);
	}

	private _correctOffset(): void {
		if (this._slots !== null && this._width === 0) {
			return;
		}
		const offset = this.rightOffset();
		const min = this._minRightOffset();
		const max = this._maxRightOffset();
		const afterMin = min !== null && offset < min ? min : offset;
		const corrected = afterMin > max ? max : afterMin;
		if (!Object.is(corrected, offset)) {
			this._setLogicalOffset(corrected);
			this._visibleRangeInvalidated = true;
		}
	}

	private _minRightOffset(): number | null {
		const firstIndex = this._firstIndex();
		const baseIndex = this._baseIndexOrNull;
		if (firstIndex === null || baseIndex === null) {
			return null;
		}

		if (this._slots !== null) {
			// the offset that puts the left edge of the first bar on the left edge of the pane
			const firstBarFits = this._rightOffsetPlacing(this._slots, firstIndex - 0.5, -1 as Coordinate);
			return this._options.fixLeftEdge
				? firstBarFits
				: Math.min(firstIndex - baseIndex - 1 + Math.min(Constants.MinVisibleBarsCount, this._points.length), firstBarFits);
		}

		const barsEstimation = this._options.fixLeftEdge
			? this._width / this._barSpacing
			: Math.min(Constants.MinVisibleBarsCount, this._points.length, this._width / this._barSpacing);

		return firstIndex - baseIndex - 1 + barsEstimation;
	}

	private _maxRightOffset(): number {
		if (this._options.fixRightEdge) {
			return 0;
		}

		if (this._slots !== null) {
			// the offset that keeps the last bars on the left edge of the pane, or 0 if they do not fit
			const minVisibleBars = Math.min(Constants.MinVisibleBarsCount, this._points.length);
			return Math.max(0, this._rightOffsetPlacing(this._slots, this.baseIndex() + 0.5 - minVisibleBars, -1 as Coordinate));
		}

		return (this._width / this._barSpacing) - Math.min(Constants.MinVisibleBarsCount, this._points.length, this._width / this._barSpacing);
	}

	private _saveCommonTransitionsStartState(): void {
		this._commonTransitionStartState = {
			barSpacing: this.barSpacing(),
			rightOffset: this.rightOffset(),
		};
	}

	private _clearCommonTransitionsStartState(): void {
		this._commonTransitionStartState = null;
	}

	private _formatLabel(tickMark: TickMark): string {
		let formatter = this._formattedByWeight.get(tickMark.weight);
		if (formatter === undefined) {
			formatter = new FormattedLabelsCache(
				(mark: TickMark) => {
					return this._formatLabelImpl(mark);
				},
				this._horzScaleBehavior);

			this._formattedByWeight.set(tickMark.weight, formatter);
		}

		return formatter.format(tickMark);
	}

	private _formatLabelImpl(tickMark: TickMark): string {
		return this._horzScaleBehavior.formatTickmark(tickMark, this._localizationOptions);
	}

	private _setVisibleRange(newVisibleRange: TimeScaleVisibleRange): void {
		const oldVisibleRange = this._visibleRange;
		this._visibleRange = newVisibleRange;

		if (!areRangesEqual(oldVisibleRange.strictRange(), this._visibleRange.strictRange())) {
			this._visibleBarsChanged.fire();
		}

		if (!areRangesEqual(oldVisibleRange.logicalRange(), this._visibleRange.logicalRange())) {
			this._logicalRangeChanged.fire();
		}

		// TODO: reset only coords in case when this._visibleBars has not been changed
		this._resetTimeMarksCache();
	}

	private _resetTimeMarksCache(): void {
		this._timeMarksCache = null;
	}

	private _invalidateTickMarks(): void {
		this._resetTimeMarksCache();
		this._formattedByWeight.clear();
	}

	private _updateDateTimeFormatter(): void {
		this._horzScaleBehavior.updateFormatter(this._localizationOptions);
	}

	private _doFixLeftEdge(): void {
		if (!this._options.fixLeftEdge) {
			return;
		}

		const firstIndex = this._firstIndex();
		if (firstIndex === null) {
			return;
		}

		const visibleRange = this.visibleStrictRange();
		if (visibleRange === null) {
			return;
		}

		const delta = visibleRange.left() - firstIndex;
		if (delta < 0) {
			// a bar count is not a distance with slot widths; the minimum offset pins the first bar exactly
			const leftEdgeOffset = this._slots === null
				? this._rightOffset - delta - 1
				: this._minRightOffset() ?? this.rightOffset();
			this.setRightOffset(leftEdgeOffset);
		}

		this._correctBarSpacing();
	}

	private _doFixRightEdge(): void {
		this._correctOffset();

		this._correctBarSpacing();
	}

	private _shouldConsiderIndex(index: TimePointIndex): boolean {
		if (!this._options.ignoreWhitespaceIndices) {
			return true;
		}
		return this._indicesWithData.get(index) || false;
	}

	private _findNearestIndexWithData(x: TimePointIndex): TimePointIndex {
		const gen = testNearestIntegers(x);
		const maxIndex = this._lastIndex();
		while (maxIndex) {
			const index = gen.next().value as TimePointIndex;
			if (this._indicesWithData.get(index)) {
				return index;
			}
			if (index < 0 || index > maxIndex) {
				break;
			}
		}
		return x; // fallback to original index
	}

	private _findNearestSlotWithData(index: TimePointIndex, x: Coordinate): TimePointIndex {
		let left = Math.min(index - 1, this._points.length - 1) as TimePointIndex;
		let right = Math.max(index + 1, 0) as TimePointIndex;
		while (left >= 0 && !this._shouldConsiderIndex(left)) {
			left = left - 1 as TimePointIndex;
		}
		while (right < this._points.length && !this._shouldConsiderIndex(right)) {
			right = right + 1 as TimePointIndex;
		}
		if (left < 0) {
			return right < this._points.length ? right : index;
		}
		if (right >= this._points.length) {
			return left;
		}
		return Math.abs(x - this.indexToCoordinate(left)) <= Math.abs(x - this.indexToCoordinate(right)) ? left : right;
	}

	private _checkRightOffsetPixels(options: DeepPartial<HorzScaleOptions>): void {
		if (options.rightOffsetPixels !== undefined) {
			const bars = this._slots === null ? options.rightOffsetPixels / (options.barSpacing || this._barSpacing) : undefined;
			this._model.setRightOffset(bars, options.rightOffsetPixels);
		}
	}
}

function* testNearestIntegers(num: number): Generator<number, number, unknown> {
	const rounded = Math.round(num);
	const isRoundedDown = rounded < num;
	let offset = 1;

	while (true) {
		if (isRoundedDown) {
			yield rounded + offset;
			yield rounded - offset;
		} else {
			yield rounded - offset;
			yield rounded + offset;
		}
		offset++;
	}
}
