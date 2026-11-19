import { DeepPartial } from '../helpers/strict-type-checks';

import { Coordinate } from '../model/coordinate';
import { IRange, Logical, LogicalRange, TimePointIndex } from '../model/time-data';
import { HorzScaleOptions } from '../model/time-scale';

/**
 * A custom function used to handle changes to the time scale's time range.
 */
export type TimeRangeChangeEventHandler<HorzScaleItem> = (timeRange: IRange<HorzScaleItem> | null) => void;
/**
 * A custom function used to handle changes to the time scale's logical range.
 */
export type LogicalRangeChangeEventHandler = (logicalRange: LogicalRange | null) => void;
/**
 * A custom function used to handle changes to the time scale's size.
 */
export type SizeChangeEventHandler = (width: number, height: number) => void;

/**
 * The relative horizontal width of one time point's slot on the time scale.
 *
 * See {@link ITimeScaleApi.setSlotWidths}.
 */
export interface SlotWidth<HorzScaleItem> {
	/** Time of the time point. Points are matched by time, so a width stays with its point when data is prepended. */
	time: HorzScaleItem;
	/**
	 * Width relative to the default slot: `1` is the default, `2` is twice as wide.
	 * Must be a finite number above `0`; values are clamped to the range `[0.1, 20]`.
	 */
	width: number;
}

/** Interface to chart time scale */
export interface ITimeScaleApi<HorzScaleItem> {
	/**
	 * Return the distance from the right edge of the time scale to the lastest bar of the series measured in bars.
	 */
	scrollPosition(): number;

	/**
	 * Scrolls the chart to the specified position.
	 *
	 * @param position - Target data position
	 * @param animated - Setting this to true makes the chart scrolling smooth and adds animation
	 */
	scrollToPosition(position: number, animated: boolean): void;

	/**
	 * Restores default scroll position of the chart. This process is always animated.
	 */
	scrollToRealTime(): void;

	/**
	 * Returns current visible time range of the chart.
	 *
	 * Note that this method cannot extrapolate time and will use the only currently existent data.
	 * To get complete information about current visible range, please use {@link getVisibleLogicalRange} and {@link ISeriesApi.barsInLogicalRange}.
	 *
	 * @returns Visible range or null if the chart has no data at all.
	 */
	getVisibleRange(): IRange<HorzScaleItem> | null;

	/**
	 * Sets visible range of data.
	 *
	 * Note that this method cannot extrapolate time and will use the only currently existent data.
	 * Thus, for example, if currently a chart doesn't have data prior `2018-01-01` date and you set visible range with `from` date `2016-01-01`, it will be automatically adjusted to `2018-01-01` (and the same for `to` date).
	 *
	 * But if you can approximate indexes on your own - you could use {@link setVisibleLogicalRange} instead.
	 *
	 * @param range - Target visible range of data.
	 * @example
	 * ```js
	 * chart.timeScale().setVisibleRange({
	 *     from: (new Date(Date.UTC(2018, 0, 1, 0, 0, 0, 0))).getTime() / 1000,
	 *     to: (new Date(Date.UTC(2018, 1, 1, 0, 0, 0, 0))).getTime() / 1000,
	 * });
	 * ```
	 */
	setVisibleRange(range: IRange<HorzScaleItem>): void;

	/**
	 * Returns the current visible [logical range](/time-scale.md#logical-range) of the chart as an object with the first and last time points of the logical range, or returns `null` if the chart has no data.
	 *
	 * @returns Visible range or null if the chart has no data at all.
	 */
	getVisibleLogicalRange(): LogicalRange | null;

	/**
	 * Sets visible [logical range](/time-scale.md#logical-range) of data.
	 *
	 * @param range - Target visible logical range of data.
	 * @example
	 * ```js
	 * chart.timeScale().setVisibleLogicalRange({ from: 0, to: 10 });
	 * ```
	 */
	setVisibleLogicalRange(range: IRange<number>): void;

	/**
	 * Restores default zoom level and scroll position of the time scale.
	 */
	resetTimeScale(): void;

	/**
	 * Automatically calculates the visible range to fit all data from all series.
	 */
	fitContent(): void;

	/**
	 * Converts a logical index to local x coordinate.
	 *
	 * @param logical - Logical index needs to be converted
	 * @returns x coordinate of that time or `null` if the chart doesn't have data
	 */
	logicalToCoordinate(logical: Logical): Coordinate | null;

	/**
	 * Converts a coordinate to logical index.
	 *
	 * @param x - Coordinate needs to be converted
	 * @returns Logical index that is located on that coordinate or `null` if the chart doesn't have data
	 */
	coordinateToLogical(x: number): Logical | null;

	/**
	 * Converts time to index.
	 *
	 * @param time - Time needs to be converted
	 * @returns Index of that time or `null` if no time found on time scale
	 */
	timeToIndex(time: HorzScaleItem, findNearest?: boolean): TimePointIndex | null;

	/**
	 * Converts a time to local x coordinate.
	 *
	 * @param time - Time needs to be converted
	 * @returns X coordinate of that time or `null` if no time found on time scale
	 */
	timeToCoordinate(time: HorzScaleItem): Coordinate | null;

	/**
	 * Converts a coordinate to time.
	 *
	 * @param x - Coordinate needs to be converted.
	 * @returns Time of a bar that is located on that coordinate or `null` if there are no bars found on that coordinate.
	 */
	coordinateToTime(x: number): HorzScaleItem | null;

	/**
	 * Replaces the relative slot widths of all time points.
	 *
	 * A slot is the horizontal space of one time point; its pixel width is `width * barSpacing`.
	 * Time points without a width, including those added later, use the default width `1`,
	 * and so does the space before the first and after the last time point.
	 * Widths may be given for times that are not on the time scale yet; they apply once the point is added.
	 * An empty array restores uniform spacing.
	 *
	 * Coordinates, ranges, scrolling, zooming, tick marks, the crosshair and hit tests all follow the widths.
	 * Candlestick, bar and histogram series size each bar to its slot.
	 *
	 * @param widths - Relative widths, matched to time points by time.
	 * @throws RangeError if a width is not a finite number above `0` or a time is invalid. No widths are changed in that case.
	 *
	 * @example
	 * ```js
	 * const averageVolume = bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length || 1;
	 * const minWidth = 0.1;
	 * chart.timeScale().setSlotWidths(bars.map(bar => ({
	 *     time: bar.time,
	 *     width: Math.max(minWidth, bar.volume / averageVolume),
	 * })));
	 * ```
	 */
	setSlotWidths(widths: readonly SlotWidth<HorzScaleItem>[]): void;

	/**
	 * Sets the relative slot widths of the given times and keeps every other stored width.
	 * Use it for a still-forming bar or for history loaded at the left edge.
	 * A width of `1` restores the default for that time.
	 * Widths are kept until replaced, also for times no longer on the time scale; {@link setSlotWidths} discards them.
	 *
	 * @param widths - Relative widths, matched to time points by time.
	 * @throws RangeError if a width is not a finite number above `0` or a time is invalid. No widths are changed in that case.
	 */
	updateSlotWidths(widths: readonly SlotWidth<HorzScaleItem>[]): void;

	/**
	 * Returns the width in pixels of the slot at a logical index.
	 * Together with {@link logicalToCoordinate}, the slot center, it lets plugins align shapes to slots.
	 *
	 * @param logical - Logical index.
	 * @returns Slot width in pixels, or `null` if the chart doesn't have data.
	 */
	slotWidth(logical: Logical): number | null;

	/**
	 * Returns a width of the time scale.
	 */
	width(): number;

	/**
	 * Returns a height of the time scale.
	 */
	height(): number;

	/**
	 * Subscribe to the visible time range change events.
	 *
	 * The argument passed to the handler function is an object with `from` and `to` properties of type {@link Time}, or `null` if there is no visible data.
	 *
	 * @param handler - Handler (function) to be called when the visible indexes change.
	 * @example
	 * ```js
	 * function myVisibleTimeRangeChangeHandler(newVisibleTimeRange) {
	 *     if (newVisibleTimeRange === null) {
	 *         // handle null
	 *     }
	 *
	 *     // handle new logical range
	 * }
	 *
	 * chart.timeScale().subscribeVisibleTimeRangeChange(myVisibleTimeRangeChangeHandler);
	 * ```
	 */
	subscribeVisibleTimeRangeChange(handler: TimeRangeChangeEventHandler<HorzScaleItem>): void;

	/**
	 * Unsubscribe a handler that was previously subscribed using {@link subscribeVisibleTimeRangeChange}.
	 *
	 * @param handler - Previously subscribed handler
	 * @example
	 * ```js
	 * chart.timeScale().unsubscribeVisibleTimeRangeChange(myVisibleTimeRangeChangeHandler);
	 * ```
	 */
	unsubscribeVisibleTimeRangeChange(handler: TimeRangeChangeEventHandler<HorzScaleItem>): void;

	/**
	 * Subscribe to the visible logical range change events.
	 *
	 * The argument passed to the handler function is an object with `from` and `to` properties of type `number`, or `null` if there is no visible data.
	 *
	 * @param handler - Handler (function) to be called when the visible indexes change.
	 * @example
	 * ```js
	 * function myVisibleLogicalRangeChangeHandler(newVisibleLogicalRange) {
	 *     if (newVisibleLogicalRange === null) {
	 *         // handle null
	 *     }
	 *
	 *     // handle new logical range
	 * }
	 *
	 * chart.timeScale().subscribeVisibleLogicalRangeChange(myVisibleLogicalRangeChangeHandler);
	 * ```
	 */
	subscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeEventHandler): void;

	/**
	 * Unsubscribe a handler that was previously subscribed using {@link subscribeVisibleLogicalRangeChange}.
	 *
	 * @param handler - Previously subscribed handler
	 * @example
	 * ```js
	 * chart.timeScale().unsubscribeVisibleLogicalRangeChange(myVisibleLogicalRangeChangeHandler);
	 * ```
	 */
	unsubscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeEventHandler): void;

	/**
	 * Adds a subscription to time scale size changes
	 *
	 * @param handler - Handler (function) to be called when the time scale size changes
	 */
	subscribeSizeChange(handler: SizeChangeEventHandler): void;

	/**
	 * Removes a subscription to time scale size changes
	 *
	 * @param handler - Previously subscribed handler
	 */
	unsubscribeSizeChange(handler: SizeChangeEventHandler): void;

	/**
	 * Applies new options to the time scale.
	 *
	 * @param options - Any subset of options.
	 */
	applyOptions(options: DeepPartial<HorzScaleOptions>): void;

	/**
	 * Returns current options
	 *
	 * @returns Currently applied options
	 */
	options(): Readonly<HorzScaleOptions>;
}
