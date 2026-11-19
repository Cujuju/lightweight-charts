/* eslint-disable @typescript-eslint/no-floating-promises */
import { expect } from 'chai';
import { CanvasRenderingTarget2D, size } from 'fancy-canvas';
import { readFileSync } from 'node:fs';
import { describe, it, TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';

import { chartOptionsDefaults } from '../../src/api/options/chart-options-defaults';
import { timeScaleOptionsDefaults } from '../../src/api/options/time-scale-options-defaults';
import { TimeScaleApi } from '../../src/api/time-scale-api';
import { TimeAxisWidget } from '../../src/gui/time-axis-widget';
import { Delegate } from '../../src/helpers/delegate';
import { BarPrice } from '../../src/model/bar';
import { ChartModel } from '../../src/model/chart-model';
import { Coordinate } from '../../src/model/coordinate';
import { HorzScaleBehaviorTime } from '../../src/model/horz-scale-behavior-time/horz-scale-behavior-time';
import { Time, UTCTimestamp } from '../../src/model/horz-scale-behavior-time/types';
import { InternalHorzScaleItem } from '../../src/model/ihorz-scale-behavior';
import { ITimeScaleAnimation } from '../../src/model/invalidate-mask';
import { ISeries } from '../../src/model/iseries';
import { LocalizationOptions } from '../../src/model/localization-options';
import { RangeImpl } from '../../src/model/range-impl';
import { Series } from '../../src/model/series';
import { SeriesLinePaneView } from '../../src/model/series/line-pane-view';
import { maxSlotWidth, minSlotWidth, normalizeSlotWidth, SlotLayout } from '../../src/model/slot-layout';
import { TickMarks } from '../../src/model/tick-marks';
import { Logical, TickMarkWeightValue, TimePointIndex, TimeScalePoint } from '../../src/model/time-data';
import { HorzScaleOptions, InternalSlotWidth, TimeScale } from '../../src/model/time-scale';
import { LineStyle, LineType } from '../../src/renderers/draw-line';

const behavior = new HorzScaleBehaviorTime();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localization: LocalizationOptions<Time> = {} as any;
const precision = 1e-6;
const paneWidth = 800;
const barCount = 200;
const pixelMargin = 12;

function modelMock(): ChartModel<Time> {
	return { recalculateAllPanes: () => {}, lightUpdate: () => {}, shiftTimeScaleAnimation: () => {} } as unknown as ChartModel<Time>;
}

function internalTime(timestamp: number): InternalHorzScaleItem {
	return { timestamp: timestamp as UTCTimestamp } as unknown as InternalHorzScaleItem;
}

function points(timestamps: readonly number[]): TimeScalePoint[] {
	return timestamps.map((t: number) => ({ time: internalTime(t), timeWeight: 20 as TickMarkWeightValue, originalTime: t as UTCTimestamp }));
}

function range(count: number, start: number = 0): number[] {
	return Array.from({ length: count }, (value: unknown, i: number) => start + i);
}

// deterministic widths spanning the accepted range
function widthFor(timestamp: number): number {
	return [0.5, 1, 3, 0.25, 2, 1.5][timestamp % 6];
}

function slotWidths(timestamps: readonly number[]): InternalSlotWidth[] {
	return timestamps.map((t: number) => ({ time: internalTime(t), width: widthFor(t) }));
}

function createTimeScale(options: Partial<HorzScaleOptions> = {}, timestamps: readonly number[] = range(barCount), model: ChartModel<Time> = modelMock()): TimeScale<Time> {
	const ts = new TimeScale<Time>(model, { ...timeScaleOptionsDefaults, barSpacing: 6, rightOffset: 0, ...options }, localization, behavior);
	ts.setWidth(paneWidth);
	ts.update(points(timestamps), 0);
	ts.setBaseIndex(timestamps.length - 1 as TimePointIndex);
	return ts;
}

// a model whose time scale animations receive the shifts the time scale reports
function animatedModel(): { model: ChartModel<Time>; animations: ITimeScaleAnimation[] } {
	const model = modelMock();
	const animations: ITimeScaleAnimation[] = [];
	model.setTimeScaleAnimation = (animation: ITimeScaleAnimation) => { animations.push(animation); };
	model.shiftTimeScaleAnimation = (delta: number) => animations.forEach((animation: ITimeScaleAnimation) => animation.shift(delta));
	return { model, animations };
}

function applyFrame(ts: TimeScale<Time>, animation: ITimeScaleAnimation, time: number): void {
	ts.setAnimatedRightOffset(animation.getPosition(time));
}

// a chart model with a sized time scale, for flows that go through updateTimeScale()
function chartModel(timeScaleOptions: Partial<HorzScaleOptions>, width: number = paneWidth): ChartModel<Time> {
	const options = chartOptionsDefaults<Time>();
	options.timeScale = { ...options.timeScale, ...timeScaleOptions };
	const model = new ChartModel<Time>(() => {}, options, behavior);
	model.timeScale().setWidth(width);
	return model;
}

function coordinates(ts: TimeScale<Time>, count: number): number[] {
	return range(count).map((i: number) => ts.indexToCoordinate(i as TimePointIndex));
}

function marginAtBase(ts: TimeScale<Time>): number {
	const base = ts.baseIndex();
	return ts.width() - 1 - ts.indexToCoordinate(base) - ts.slotWidth(base) / 2;
}

describe('SlotLayout', () => {
	const layout = new SlotLayout();
	const widths = [0.5, 2, 1, 4, 0.25];
	layout.update(widths.length, 0, (i: number) => widths[i]);

	it('logicalToSlot and slotToLogical are inverse inside and outside the data', () => {
		for (let logical = -5; logical <= widths.length + 5; logical += 0.125) {
			expect(layout.slotToLogical(layout.logicalToSlot(logical))).to.be.closeTo(logical, precision);
		}
	});

	it('places each bar centre in the middle of its slot', () => {
		let start = 0;
		widths.forEach((width: number, i: number) => {
			expect(layout.center(i)).to.be.closeTo(start + width / 2, precision);
			start += width;
		});
		expect(layout.center(-1)).to.be.equal(-0.5);
		expect(layout.center(widths.length)).to.be.closeTo(start + 0.5, precision);
	});

	it('rewrites only the changed tail and tracks the maximum', () => {
		layout.update(widths.length + 1, widths.length - 1, (i: number) => i === widths.length ? 6 : 1);
		expect(layout.width(0)).to.be.equal(0.5);
		expect(layout.width(widths.length - 1)).to.be.equal(1);
		expect(layout.maxWidth()).to.be.equal(6);
	});

	it('keeps positions and the maximum right while slots are appended and the widest one narrows', () => {
		const appended = new SlotLayout();
		const widthAt = (i: number): number => i === 3 ? 8 : 1 + i % 3;
		for (let count = 1; count <= 40; count++) {
			appended.update(count, count - 1, widthAt);
		}
		const rebuilt = new SlotLayout();
		rebuilt.update(40, 0, widthAt);
		for (let i = 0; i <= 41; i++) {
			expect(appended.start(i)).to.be.equal(rebuilt.start(i));
		}
		expect(appended.maxWidth()).to.be.equal(8);

		appended.update(40, 3, (i: number) => i === 3 ? 1 : widthAt(i));
		expect(appended.maxWidth()).to.be.equal(3);
		// growing past capacity while the widest slot narrows
		const grown = new SlotLayout();
		grown.update(4, 0, (i: number) => i === 3 ? 8 : 1);
		grown.update(5, 3, () => 1);
		expect(grown.maxWidth()).to.be.equal(1);

		appended.update(2, 2, widthAt);
		expect(appended.count()).to.be.equal(2);
		expect(appended.maxWidth()).to.be.equal(2);
		expect(appended.start(5)).to.be.equal(1 + 2 + 3);
	});
});

describe('TimeScale slot widths', () => {
	it('default widths keep coordinates bit-identical', () => {
		const reference = coordinates(createTimeScale(), barCount);

		const allDefault = createTimeScale();
		allDefault.setSlotWidths(range(barCount).map((t: number) => ({ time: internalTime(t), width: 1 })));
		expect(allDefault.slotLayout()).to.be.equal(null);
		expect(coordinates(allDefault, barCount)).to.deep.equal(reference);

		const cleared = createTimeScale();
		cleared.setSlotWidths(slotWidths(range(barCount)));
		cleared.setSlotWidths([]);
		expect(cleared.slotLayout()).to.be.equal(null);
		expect(coordinates(cleared, barCount)).to.deep.equal(reference);
	});

	it('spaces neighbouring bars by the mean of their slot widths', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		const xs = coordinates(ts, barCount);
		for (let i = 1; i < barCount; i++) {
			expect(xs[i] - xs[i - 1]).to.be.closeTo((widthFor(i - 1) + widthFor(i)) / 2 * ts.barSpacing(), precision);
			expect(ts.slotWidth(i as TimePointIndex)).to.be.closeTo(widthFor(i) * ts.barSpacing(), precision);
		}
		// the last bar keeps its distance from the right edge
		expect(xs[barCount - 1]).to.be.closeTo(paneWidth - 1 - widthFor(barCount - 1) / 2 * ts.barSpacing(), precision);
	});

	it('coordinate to index round-trips for every bar and every pixel', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		const visible = ts.visibleStrictRange();
		expect(visible).to.not.equal(null);
		for (let i = Math.max(0, visible?.left() ?? 0); i <= (visible?.right() ?? 0); i++) {
			expect(ts.coordinateToIndex(ts.indexToCoordinate(i as TimePointIndex))).to.be.equal(i);
		}
		for (let x = 0; x < paneWidth; x++) {
			const index = ts.coordinateToIndex(x as Coordinate);
			const center = ts.indexToCoordinate(index);
			expect(Math.abs(x - center)).to.be.at.most(ts.slotWidth(index) / 2 + precision);
		}
	});

	it('logical range round-trips through setLogicalRange and visibleLogicalRange', () => {
		const ts = createTimeScale({ minBarSpacing: 0, maxBarSpacing: 0 });
		ts.setSlotWidths(slotWidths(range(barCount)));
		ts.setLogicalRange({ from: 20 as Logical, to: 120 as Logical });
		const logicalRange = ts.visibleLogicalRange();
		expect(logicalRange?.left()).to.be.closeTo(20, precision);
		expect(logicalRange?.right()).to.be.closeTo(120, precision);
		// the outer slot edges touch the pane edges
		expect(ts.indexToCoordinate(20 as TimePointIndex) - ts.slotWidth(20 as TimePointIndex) / 2).to.be.closeTo(-1, precision);
		expect(ts.indexToCoordinate(120 as TimePointIndex) + ts.slotWidth(120 as TimePointIndex) / 2).to.be.closeTo(paneWidth - 1, precision);
	});

	it('fitContent fits every slot into the pane', () => {
		const ts = createTimeScale({ minBarSpacing: 0 });
		ts.setSlotWidths(slotWidths(range(barCount)));
		ts.fitContent();
		expect(ts.indexToCoordinate(0 as TimePointIndex) - ts.slotWidth(0 as TimePointIndex) / 2).to.be.closeTo(-1, precision);
		const last = barCount - 1 as TimePointIndex;
		expect(ts.indexToCoordinate(last) + ts.slotWidth(last) / 2).to.be.closeTo(paneWidth - 1, precision);
	});

	it('reports a valid range when the viewport lies inside one wide slot', () => {
		const last = barCount - 1 as TimePointIndex;
		const ts = createTimeScale({ barSpacing: 100 });
		ts.setSlotWidths([{ time: internalTime(last), width: maxSlotWidth }]);
		// Centre the slot, then show only its rightmost portion.
		for (const offset of [-0.3, 0]) {
			ts.setRightOffset(offset);
			expect(ts.visibleLogicalRange()?.left()).to.be.equal(last);
			expect(ts.visibleLogicalRange()?.right()).to.be.equal(last);
			expect(ts.visibleStrictRange()?.count()).to.be.equal(1);
		}
	});

	it('fits the sum of slot widths at the zoom-out limit and restores the uniform limit', () => {
		const timestamps = range(100);
		const ts = createTimeScale({ fixLeftEdge: true, fixRightEdge: true }, timestamps);
		ts.setSlotWidths(timestamps.map((t: number) => ({ time: internalTime(t), width: 4 })));
		ts.setBarSpacing(1);
		expect(ts.barSpacing()).to.be.equal(2);
		expect(ts.indexToCoordinate(0 as TimePointIndex) - ts.slotWidth(0 as TimePointIndex) / 2).to.be.closeTo(-1, precision);

		ts.updateSlotWidths(timestamps.map((t: number) => ({ time: internalTime(t), width: 2 })));
		expect(ts.barSpacing()).to.be.equal(4);
		ts.setSlotWidths([]);
		expect(ts.barSpacing()).to.be.equal(8);
	});

	it('ignores width changes in drag velocity and retains the animated logical destination', () => {
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, range(barCount), model);
		const setWidths = (width: number): void => ts.setSlotWidths(range(barCount).map((t: number) => ({ time: internalTime(t), width })));

		setWidths(2);
		ts.setRightOffset(-12);
		const pointer = 400 as Coordinate;
		ts.startScroll(pointer);
		const start = ts.kineticScrollPosition();
		setWidths(0.5);
		ts.scrollTo(pointer);
		expect(ts.kineticScrollPosition()).to.be.closeTo(start, precision);
		ts.endScroll();

		setWidths(2);
		ts.scrollToOffsetAnimated(-20);
		setWidths(0.5);
		const end = performance.now() + 5000;
		expect(animations[0].finished(end)).to.be.equal(true);
		applyFrame(ts, animations[0], end);
		expect(ts.rightOffset()).to.be.closeTo(-20, precision);
	});

	it('starts an animation from the current viewport after its slot layout changes', (t: TestContext) => {
		const firstFrame = 1000;
		t.mock.method(performance, 'now', () => firstFrame);
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, range(barCount), model);
		ts.setSlotWidths(range(barCount).map((time: number) => ({ time: internalTime(time), width: 2 })));
		ts.setRightOffset(-40);
		ts.scrollToOffsetAnimated(-20);
		ts.setSlotWidths(range(barCount).map((time: number) => ({ time: internalTime(time), width: 0.5 })));
		applyFrame(ts, animations[0], firstFrame);
		expect(ts.rightOffset()).to.be.closeTo(-40, precision);
	});

	it('never passes the target when widths change between animation frames', (t: TestContext) => {
		const start = 1000;
		const duration = 1000;
		let now = start;
		t.mock.method(performance, 'now', () => now);
		const { model, animations } = animatedModel();
		const timestamps = range(barCount);
		const ts = createTimeScale({}, timestamps, model);
		const setWidths = (width: number): void => ts.setSlotWidths(timestamps.map((time: number) => ({ time: internalTime(time), width })));
		setWidths(2);
		ts.setRightOffset(-40);
		ts.scrollToOffsetAnimated(-20, duration);

		applyFrame(ts, animations[0], start + 940);
		const beforeChange = ts.rightOffset();
		// the widths change after the frame was drawn and before the next one
		now = start + 960;
		setWidths(0.1);
		expect(ts.rightOffset()).to.be.closeTo(beforeChange, precision);
		let previous = beforeChange;
		for (const time of [960, 980, 1000]) {
			applyFrame(ts, animations[0], start + time);
			expect(ts.rightOffset()).to.be.at.least(previous - precision);
			expect(ts.rightOffset()).to.be.at.most(-20 + precision);
			previous = ts.rightOffset();
		}
		expect(previous).to.be.closeTo(-20, precision);
	});

	it('never passes the target when the widths are cleared between animation frames', (t: TestContext) => {
		const start = 1000;
		const duration = 1000;
		let now = start;
		t.mock.method(performance, 'now', () => now);
		const { model, animations } = animatedModel();
		const timestamps = range(barCount);
		const ts = createTimeScale({}, timestamps, model);
		ts.setSlotWidths(timestamps.map((time: number) => ({ time: internalTime(time), width: 2 })));
		ts.setRightOffset(-40);
		ts.scrollToOffsetAnimated(-20, duration);

		applyFrame(ts, animations[0], start + 940);
		let previous = ts.rightOffset();
		// well after the frame that was drawn, and before the next one
		now = start + 995;
		ts.setSlotWidths([]);
		expect(ts.rightOffset()).to.be.closeTo(previous, precision);
		// the animation still passes through the drawn position at the drawn frame's time
		expect(animations[0].getPosition(start + 940)).to.be.closeTo(ts.slotRightOffset(), precision);
		for (const time of [960, 980, 1000]) {
			now = start + time;
			applyFrame(ts, animations[0], now);
			expect(ts.rightOffset()).to.be.at.least(previous - precision);
			expect(ts.rightOffset()).to.be.at.most(-20 + precision);
			previous = ts.rightOffset();
		}
		expect(previous).to.be.closeTo(-20, precision);
	});

	it('does not move the view when widths change during a kinetic scroll', (t: TestContext) => {
		const start = 1000;
		t.mock.method(performance, 'now', () => start);
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, range(barCount), model);
		ts.setRightOffset(-30);
		// a constant-velocity animation in slot units, as kinetic scrolling produces
		let origin = ts.slotRightOffset();
		const velocity = -0.01;
		model.setTimeScaleAnimation({
			getPosition: (time: number) => origin + velocity * (time - start),
			finished: () => false,
			shift: (delta: number) => { origin -= delta; },
		});
		applyFrame(ts, animations[0], start + 100);
		const visibleCount = barCount - 32;
		const before = coordinates(ts, visibleCount);

		ts.updateSlotWidths(range(30, barCount - 30).map((time: number) => ({ time: internalTime(time), width: 4 })));
		coordinates(ts, visibleCount).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
		applyFrame(ts, animations[0], start + 100);
		coordinates(ts, visibleCount).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
	});

	it('advances the animation when the slot layout changes before every frame', (t: TestContext) => {
		const start = 1000;
		const duration = 800;
		let now = start;
		t.mock.method(performance, 'now', () => now);
		const { model, animations } = animatedModel();
		const timestamps = range(barCount);
		const ts = createTimeScale({}, timestamps, model);
		const setWidths = (width: number): void => ts.setSlotWidths(timestamps.map((time: number) => ({ time: internalTime(time), width })));
		setWidths(2);
		const source = -40;
		const target = -20;
		ts.setRightOffset(source);
		ts.scrollToOffsetAnimated(target, duration);

		for (const fraction of [0.25, 0.5, 0.75, 1]) {
			// the layout changes at the previous frame's time
			setWidths(fraction === 0.5 ? 2 : 0.5);
			now = start + fraction * duration;
			applyFrame(ts, animations[0], now);
			expect(ts.rightOffset()).to.be.closeTo(source + (target - source) * fraction, precision);
		}
	});

	it('preserves or restores the pixel margin across viewport and data changes', (t: TestContext) => {
		const options = chartOptionsDefaults<Time>();
		options.timeScale = {
			...options.timeScale,
			rightOffsetPixels: pixelMargin,
			rightBarStaysOnScroll: true,
			allowShiftVisibleRangeOnWhitespaceReplacement: true,
		};
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		t.mock.method(model, 'setRightOffset', (offset: number, slotUnits?: boolean) => {
			if (slotUnits) {
				ts.setSlotRightOffset(offset);
			} else {
				ts.setRightOffset(offset);
			}
		});
		ts.setWidth(paneWidth);
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.restoreDefault();

		const steps: Record<string, () => void> = {
			register: () => ts.setSlotWidths(slotWidths(range(barCount + 4))),
			append: () => model.updateTimeScale(barCount as TimePointIndex, points(range(barCount + 1)), barCount),
			prepend: () => model.updateTimeScale(barCount + 1 as TimePointIndex, points([-1, ...range(barCount + 1)]), 0),
			addWhitespace: () => model.updateTimeScale(barCount + 1 as TimePointIndex, points([-1, ...range(barCount + 3)]), barCount + 2),
			replaceWhitespace: () => model.updateTimeScale(barCount + 2 as TimePointIndex),
			updateSlotWidths: () => ts.updateSlotWidths([{ time: internalTime(barCount + 1), width: 4 }]),
			spacing: () => ts.setBarSpacing(4),
			zoom: () => ts.zoom(400 as Coordinate, -2),
			clear: () => ts.setSlotWidths([]),
			registerAgain: () => ts.setSlotWidths(slotWidths(range(barCount + 4))),
			fit: () => { ts.setRightOffset(0); ts.fitContent(); },
			restore: () => { ts.setRightOffset(0); ts.restoreDefault(); },
			applyOptions: () => { ts.setRightOffset(0); ts.applyOptions({ rightOffsetPixels: pixelMargin }); },
		};

		for (const [step, apply] of Object.entries(steps)) {
			apply();
			expect(marginAtBase(ts), step).to.be.closeTo(pixelMargin, 0.5);
		}
	});

	it('keeps a pixel right offset across wide whitespace slots', () => {
		const model = modelMock();
		const ts = createTimeScale({ rightBarStaysOnScroll: true }, range(barCount), model);
		const pendingSlotOffsets: number[] = [];
		model.setRightOffset = (offset: number, slotUnits?: boolean) => {
			expect(slotUnits).to.be.equal(true);
			pendingSlotOffsets.push(offset);
		};
		const lastBar = barCount - 5 as TimePointIndex;
		ts.setBaseIndex(lastBar);
		ts.applyOptions({ rightOffsetPixels: 12 });
		ts.setSlotWidths([{ time: internalTime(lastBar + 1), width: 4 }]);
		const expectMargin = (pixels: number): void => {
			expect(paneWidth - 1 - ts.indexToCoordinate(lastBar) - ts.slotWidth(lastBar) / 2).to.be.closeTo(pixels, precision);
		};

		ts.setSlotRightOffset(pendingSlotOffsets[0]);
		expectMargin(12);
		ts.setRightOffset(0);
		ts.restoreDefault();
		expectMargin(12);
		ts.fitContent();
		expectMargin(12);
		// Zoom out until the margin extends past the first whitespace slot.
		ts.zoom(400 as Coordinate, -6);
		expectMargin(12);
	});

	it('keeps a pixel margin when registered whitespace widths arrive with new points', () => {
		const model = modelMock();
		model.setRightOffset = () => {};
		const ts = createTimeScale({}, range(barCount), model);
		const lastBar = barCount - 1 as TimePointIndex;
		const margin = 12;
		ts.updateSlotWidths(range(4, barCount).map((t: number) => ({ time: internalTime(t), width: 4 })));
		ts.applyOptions({ rightOffsetPixels: margin });
		ts.setSlotRightOffset(margin / ts.barSpacing());
		ts.update(points(range(barCount + 4)), barCount);
		expect(paneWidth - 1 - ts.indexToCoordinate(lastBar) - ts.slotWidth(lastBar) / 2).to.be.closeTo(margin, precision);
	});

	it('keeps a pixel margin when new points advance the base and add wide whitespace', () => {
		const margin = 12;
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, rightOffsetPixels: margin };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		ts.setWidth(paneWidth);
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.setSlotWidths([{ time: internalTime(barCount + 1), width: 4 }]);
		ts.restoreDefault();

		const newBase = barCount as TimePointIndex;
		model.updateTimeScale(newBase, points(range(barCount + 2)), barCount);
		const rightEdge = ts.indexToCoordinate(newBase) + ts.slotWidth(newBase) / 2;
		expect(paneWidth - 1 - rightEdge).to.be.closeTo(margin, precision);
	});

	it('keeps a pixel margin when replacing whitespace advances only the base', () => {
		const margin = 12;
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, rightOffsetPixels: margin, allowShiftVisibleRangeOnWhitespaceReplacement: true };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		const newBase = barCount as TimePointIndex;
		ts.setWidth(paneWidth);
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount + 1)), 0);
		ts.setSlotWidths([{ time: internalTime(newBase), width: 4 }]);
		ts.restoreDefault();

		model.updateTimeScale(newBase);
		const rightEdge = ts.indexToCoordinate(newBase) + ts.slotWidth(newBase) / 2;
		expect(paneWidth - 1 - rightEdge).to.be.closeTo(margin, precision);
	});

	it('zoom keeps the point under the cursor in place with a pixel margin', () => {
		const model = modelMock();
		model.setRightOffset = () => {};
		const ts = createTimeScale({ rightOffsetPixels: pixelMargin }, range(barCount), model);
		ts.setSlotWidths(slotWidths(range(barCount)));
		ts.restoreDefault();
		const zoomPoint = ts.indexToCoordinate(150 as TimePointIndex);
		ts.zoom(zoomPoint, 3);
		expect(ts.indexToCoordinate(150 as TimePointIndex)).to.be.closeTo(zoomPoint, precision);
		expect(marginAtBase(ts)).to.be.lessThan(0);
	});

	it('keeps scrolled-back bars in place when a bar right of the pane changes width', () => {
		for (const options of [{}, { rightOffsetPixels: pixelMargin }]) {
			const model = modelMock();
			model.setRightOffset = () => {};
			const ts = createTimeScale(options, range(barCount), model);
			ts.setSlotWidths(slotWidths(range(barCount)));
			ts.setRightOffset(-40);
			const visibleCount = barCount - 40;
			const before = coordinates(ts, visibleCount);
			const kineticBefore = ts.kineticScrollPosition();

			ts.updateSlotWidths([{ time: internalTime(barCount - 1), width: 5 }]);
			coordinates(ts, visibleCount).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
			expect(ts.rightOffset()).to.be.closeTo(-40, precision);
			expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
		}
	});

	it('keeps the gap to the last bar when it changes width in view', () => {
		const model = modelMock();
		model.setRightOffset = () => {};
		const ts = createTimeScale({ rightOffsetPixels: pixelMargin }, range(barCount), model);
		ts.setSlotWidths(slotWidths(range(barCount)));
		ts.restoreDefault();
		expect(marginAtBase(ts)).to.be.closeTo(pixelMargin, precision);
		ts.updateSlotWidths([{ time: internalTime(barCount - 1), width: 5 }]);
		expect(marginAtBase(ts)).to.be.closeTo(pixelMargin, precision);
	});

	it('does not move the kinetic position while a drag is pinned at a fixed edge', () => {
		const ts = createTimeScale({ fixRightEdge: true });
		ts.setSlotWidths(slotWidths(range(barCount)));
		const position = ts.kineticScrollPosition();
		ts.startScroll(200 as Coordinate);
		for (const x of [100, 150]) {
			ts.scrollTo(x as Coordinate);
			expect(ts.kineticScrollPosition()).to.be.equal(position);
		}
		ts.endScroll();
	});

	it('ignores a zero width, keeping the range and firing no events', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		const before = ts.visibleLogicalRange();
		let events = 0;
		ts.logicalRangeChanged().subscribe(() => { events++; });

		ts.setWidth(0);
		expect(ts.visibleLogicalRange()).to.be.equal(before);
		expect(ts.indexToCoordinate(100 as TimePointIndex)).to.not.equal(0);
		ts.setWidth(paneWidth);
		ts.visibleLogicalRange();
		expect(events).to.be.equal(0);
	});

	it('scrolling keeps the grabbed bar under the pointer and moves the kinetic position in pixels', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		const start = 400 as Coordinate;
		const index = ts.coordinateToIndex(start);
		const offsetFromPointer = ts.indexToCoordinate(index) - start;
		const kineticBefore = ts.kineticScrollPosition();
		const shift = 137;

		ts.startScroll(start);
		ts.scrollTo(start + shift as Coordinate);
		ts.endScroll();

		expect(ts.indexToCoordinate(index)).to.be.closeTo(start + shift + offsetFromPointer, precision);
		expect(ts.kineticScrollPosition() - kineticBefore).to.be.closeTo(-shift / ts.barSpacing(), precision);
	});

	it('slotRightOffset round-trips and equals rightOffset without widths', () => {
		const plain = createTimeScale();
		plain.setRightOffset(-37.25);
		expect(plain.slotRightOffset()).to.be.equal(plain.rightOffset());

		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		ts.setRightOffset(-37.25);
		const slotOffset = ts.slotRightOffset();
		ts.setSlotRightOffset(slotOffset);
		expect(ts.rightOffset()).to.be.closeTo(-37.25, precision);
	});

	it('keeps widths attached to times when history is prepended and whitespace inserted', () => {
		const ts = createTimeScale({}, range(barCount, 100));
		ts.setSlotWidths(slotWidths(range(barCount, 100)));
		const prepended = range(barCount + 100);
		ts.update(points(prepended), 0);
		ts.setBaseIndex(prepended.length - 1 as TimePointIndex);
		for (let t = 100; t < barCount + 100; t++) {
			expect(ts.slotWidth(t as TimePointIndex)).to.be.closeTo(widthFor(t) * ts.barSpacing(), precision);
		}
		expect(ts.slotWidth(0 as TimePointIndex)).to.be.equal(ts.barSpacing());

		// a whitespace point between 150 and 151 shifts later bars by one index
		const withGap = [...range(151), 150.5, ...range(barCount + 100 - 151, 151)];
		ts.update(points(withGap), 151);
		expect(ts.slotWidth(150 as TimePointIndex)).to.be.closeTo(widthFor(150) * ts.barSpacing(), precision);
		expect(ts.slotWidth(151 as TimePointIndex)).to.be.equal(ts.barSpacing());
		expect(ts.slotWidth(152 as TimePointIndex)).to.be.closeTo(widthFor(151) * ts.barSpacing(), precision);
	});

	it('updateSlotWidths changes only the given times and moves only bars left of the change', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		const before = coordinates(ts, barCount);
		const changed = barCount - 10;
		ts.updateSlotWidths([{ time: internalTime(changed), width: 5 }]);
		const after = coordinates(ts, barCount);
		const shift = (5 - widthFor(changed)) * ts.barSpacing();
		for (let i = 0; i < barCount; i++) {
			const expected = i < changed ? before[i] - shift : i === changed ? before[i] - shift / 2 : before[i];
			expect(after[i]).to.be.closeTo(expected, precision);
		}
	});

	it('fixLeftEdge and fixRightEdge clamp to the slot edges', () => {
		const ts = createTimeScale({ fixLeftEdge: true, fixRightEdge: true });
		ts.setSlotWidths(slotWidths(range(barCount)));
		ts.setRightOffset(50);
		const last = barCount - 1 as TimePointIndex;
		expect(ts.indexToCoordinate(last) + ts.slotWidth(last) / 2).to.be.closeTo(paneWidth - 1, precision);
		ts.setRightOffset(-1e6);
		expect(ts.indexToCoordinate(0 as TimePointIndex) - ts.slotWidth(0 as TimePointIndex) / 2).to.be.closeTo(-1, precision);
	});

	it('keeps the view in place when a bar is appended and reports the slot shift', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount + 1)));
		ts.setRightOffset(-40);
		const before = coordinates(ts, barCount);
		const kineticBefore = ts.kineticScrollPosition();

		ts.update(points(range(barCount + 1)), barCount);
		const slotShift = ts.advanceBaseIndex(barCount as TimePointIndex, 1);

		coordinates(ts, barCount).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
		// slot offsets are measured from the base bar's right edge, which moved by the new bar's width
		expect(slotShift).to.be.closeTo(widthFor(barCount), precision);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
	});

	it('keeps the viewport in place when a wide appended bar is not followed in pixel mode', () => {
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, rightOffsetPixels: pixelMargin, shiftVisibleRangeOnNewBar: false };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		ts.setWidth(paneWidth);
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.setSlotWidths([{ time: internalTime(barCount), width: 4 }]);
		ts.restoreDefault();
		const before = coordinates(ts, barCount);
		const kineticBefore = ts.kineticScrollPosition();

		model.updateTimeScale(barCount as TimePointIndex, points(range(barCount + 1)), barCount);
		expect(coordinates(ts, barCount)).to.deep.equal(before);
		expect(marginAtBase(ts)).to.be.closeTo(pixelMargin - ts.slotWidth(ts.baseIndex()), precision);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
	});

	it('keeps the view in place when a wide appended bar is not followed and the offset is in bars', () => {
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, rightOffset: 20, shiftVisibleRangeOnNewBar: false };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		ts.setWidth(paneWidth);
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.setSlotWidths([{ time: internalTime(barCount), width: 10 }, { time: internalTime(0), width: 2 }]);
		ts.restoreDefault();
		const before = coordinates(ts, barCount);

		model.updateTimeScale(barCount as TimePointIndex, points(range(barCount + 1)), barCount);
		coordinates(ts, barCount).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
	});

	it('keeps the view in place when an unfollowed wide append lowers the offset limit', () => {
		const model = chartModel({ barSpacing: 10, shiftVisibleRangeOnNewBar: false }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		ts.setSlotWidths([{ time: internalTime(20), width: 5 }]);
		ts.setRightOffset(8);
		const before = ts.indexToCoordinate(19 as TimePointIndex);
		const kineticBefore = ts.kineticScrollPosition();

		model.updateTimeScale(20 as TimePointIndex, points(range(21)), 20);
		expect(ts.indexToCoordinate(19 as TimePointIndex)).to.be.closeTo(before, precision);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
	});

	it('keeps a scrolled-back view in place when a wide point is inserted right of it', () => {
		const model = chartModel({ barSpacing: 10 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		ts.setSlotWidths([{ time: internalTime(16.5), width: 5 }]);
		ts.setRightOffset(-10);
		const before = coordinates(ts, 10);

		const withInsert = [...range(17), 16.5, ...range(3, 17)];
		model.updateTimeScale(20 as TimePointIndex, points(withInsert), 17);
		coordinates(ts, 10).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
	});

	it('keeps widths on their times when a point is removed with a late first changed index', () => {
		const ts = createTimeScale({}, range(4));
		ts.setSlotWidths([{ time: internalTime(1), width: 3 }, { time: internalTime(2), width: 5 }]);
		// the data layer reports the last remaining index for a removal
		ts.update(points([0, 2, 3]), 2);
		ts.setBaseIndex(2 as TimePointIndex);
		expect(ts.slotWidth(1 as TimePointIndex)).to.be.equal(5 * ts.barSpacing());
		expect(ts.slotWidth(2 as TimePointIndex)).to.be.equal(ts.barSpacing());
	});

	it('keeps the first bar pinned when a fixed left edge chart is resized', () => {
		for (const barSpacing of [5.3, 6, 7]) {
			const ts = createTimeScale({ fixLeftEdge: true, barSpacing });
			ts.setSlotWidths(slotWidths(range(barCount)));
			ts.setRightOffset(-1e6);
			const leftEdge = (): number => ts.indexToCoordinate(0 as TimePointIndex) - ts.slotWidth(0 as TimePointIndex) / 2;
			expect(leftEdge()).to.be.closeTo(-1, precision);
			for (const width of [paneWidth - 100, paneWidth + 60]) {
				ts.setWidth(width);
				expect(leftEdge(), `spacing ${barSpacing}, width ${width}`).to.be.closeTo(-1, precision);
			}
		}
	});

	it('keeps the first bar pinned on resize after appends and width calls moved the offset by arithmetic', () => {
		for (const barSpacing of [5.3, 6, 9.1]) {
			const model = chartModel({ fixLeftEdge: true, barSpacing, shiftVisibleRangeOnNewBar: false });
			const ts = model.timeScale();
			const count = 300;
			const widths = [0.3, 1.7, 2.9, 0.7];
			ts.setSlotWidths(range(count + 40).map((time: number) => ({ time: internalTime(time), width: widths[time % widths.length] })));
			model.updateTimeScale(count - 1 as TimePointIndex, points(range(count)), 0);
			ts.setRightOffset(-1e6);
			const leftEdge = (): number => ts.indexToCoordinate(0 as TimePointIndex) - ts.slotWidth(0 as TimePointIndex) / 2;

			let width = paneWidth;
			for (let appended = 1; appended <= 30; appended++) {
				model.updateTimeScale(count - 1 + appended as TimePointIndex, points(range(count + appended)), count - 1 + appended);
				// a width for a time that is not on the scale changes no layout
				ts.updateSlotWidths([{ time: internalTime(1e6 + appended), width: 2 }]);
				width -= 7;
				ts.setWidth(width);
				expect(leftEdge(), `spacing ${barSpacing}, ${appended} appended`).to.be.closeTo(-1, precision);
			}
		}
	});

	it('keeps the scroll position when the data is cleared and loaded again', () => {
		const model = chartModel({});
		const ts = model.timeScale();
		const timestamps = range(20);
		model.updateTimeScale(19 as TimePointIndex, points(timestamps), 0);
		ts.setSlotWidths([{ time: internalTime(19), width: 10 }, { time: internalTime(3), width: 4 }]);
		ts.setRightOffset(-1);

		model.updateTimeScale(null, [], 0);
		model.updateTimeScale(19 as TimePointIndex, points(timestamps), 0);
		expect(ts.rightOffset()).to.be.closeTo(-1, precision);
	});

	it('keeps a pixel margin applied to an empty chart when data with wide whitespace arrives', () => {
		const model = chartModel({ barSpacing: 10, rightOffsetPixels: 20 });
		const ts = model.timeScale();
		// the frame applies the queued pixel offset in slot units
		ts.setSlotRightOffset(20 / ts.barSpacing());
		ts.setSlotWidths([{ time: internalTime(20), width: 5 }]);
		model.updateTimeScale(19 as TimePointIndex, points(range(21)), 0);
		expect(marginAtBase(ts)).to.be.closeTo(20, precision);
	});

	it('counts a negative right offset option in bars when widths arrive before the first sizing', () => {
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, rightOffset: -3 };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		ts.setSlotWidths([{ time: internalTime(18), width: 10 }, { time: internalTime(19), width: 10 }]);
		ts.setWidth(paneWidth);
		expect(ts.rightOffset()).to.be.closeTo(-3, precision);
	});

	it('counts a negative right offset option in bars when widths arrive before the data', () => {
		const model = chartModel({ rightOffset: -2 });
		const ts = model.timeScale();
		ts.setSlotWidths([{ time: internalTime(19), width: 10 }]);
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		expect(ts.rightOffset()).to.be.closeTo(-2, precision);
	});

	it('refreshes the conflation factor when widths change the fixed-edge spacing', (t: TestContext) => {
		// the conflation threshold reads the device pixel ratio from the window
		const globals = globalThis as { window?: unknown };
		globals.window = { devicePixelRatio: 1 };
		t.after(() => { delete globals.window; });
		const timestamps = range(barCount);
		const ts = createTimeScale({ fixLeftEdge: true, fixRightEdge: true, enableConflation: true, minBarSpacing: 0.1 }, timestamps);
		ts.setWidth(100);
		ts.setBarSpacing(0.5);
		expect(ts.conflationFactor()).to.be.equal(2);
		ts.setSlotWidths(timestamps.map((time: number) => ({ time: internalTime(time), width: minSlotWidth })));
		expect(ts.barSpacing()).to.be.closeTo(5, precision);
		expect(ts.conflationFactor()).to.be.equal(1);
	});

	it('refreshes the conflation factor when new data changes the fixed-edge spacing', (t: TestContext) => {
		const globals = globalThis as { window?: unknown };
		globals.window = { devicePixelRatio: 1 };
		t.after(() => { delete globals.window; });
		const model = chartModel({ fixLeftEdge: true, fixRightEdge: true, enableConflation: true, minBarSpacing: 0.1 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.setBarSpacing(0.5);
		expect(ts.conflationFactor()).to.be.equal(2);

		const replacement = range(barCount, 1000);
		ts.updateSlotWidths(replacement.map((time: number) => ({ time: internalTime(time), width: minSlotWidth })));
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(replacement), 0);
		expect(ts.barSpacing()).to.be.closeTo(5, precision);
		expect(ts.conflationFactor()).to.be.equal(1);
	});

	it('keeps the bar spacing when widths and data arrive before the first sizing', () => {
		const options = chartOptionsDefaults<Time>();
		const flows: ((model: ChartModel<Time>) => void)[] = [
			(model: ChartModel<Time>) => {
				model.timeScale().setSlotWidths([{ time: internalTime(3), width: 4 }]);
				model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
			},
			(model: ChartModel<Time>) => {
				model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
				model.timeScale().setSlotWidths([{ time: internalTime(3), width: 4 }]);
				model.updateTimeScale(20 as TimePointIndex, points(range(21)), 20);
			},
		];
		for (const flow of flows) {
			const model = new ChartModel<Time>(() => {}, options, behavior);
			flow(model);
			model.timeScale().setWidth(paneWidth);
			expect(model.timeScale().barSpacing()).to.be.equal(options.timeScale.barSpacing);
		}
	});

	it('counts a scrolled-back offset in bars while the chart is empty', () => {
		const timestamps = range(20);
		const wide = [{ time: internalTime(19), width: 10 }, { time: internalTime(18), width: 4 }];
		const whileEmpty: ((ts: TimeScale<Time>) => void)[] = [
			(ts: TimeScale<Time>) => ts.setSlotWidths([]),
			(ts: TimeScale<Time>) => ts.setSlotWidths(wide),
			(ts: TimeScale<Time>) => { ts.setSlotWidths([]); ts.setSlotWidths(wide); },
		];
		for (const initialWidths of [[], wide]) {
			whileEmpty.forEach((change: (ts: TimeScale<Time>) => void, i: number) => {
				const model = chartModel({});
				const ts = model.timeScale();
				model.updateTimeScale(19 as TimePointIndex, points(timestamps), 0);
				ts.setSlotWidths(initialWidths);
				ts.setRightOffset(-5);

				model.updateTimeScale(null, [], 0);
				expect(ts.rightOffset()).to.be.closeTo(-5, precision);
				change(ts);
				expect(ts.rightOffset()).to.be.closeTo(-5, precision);
				model.updateTimeScale(19 as TimePointIndex, points(timestamps), 0);
				expect(ts.rightOffset(), `${initialWidths.length} widths, change ${i}`).to.be.closeTo(-5, precision);
			});
		}
	});

	it('counts an animated scroll that ends on an empty chart in bars', (t: TestContext) => {
		const start = 1000;
		const duration = 1000;
		t.mock.method(performance, 'now', () => start);
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, [], model);
		ts.setBaseIndex(null);
		ts.setSlotWidths([{ time: internalTime(19), width: 10 }]);
		ts.scrollToOffsetAnimated(-10, duration);
		applyFrame(ts, animations[0], start + duration);

		ts.update(points(range(20)), 0);
		ts.setBaseIndex(19 as TimePointIndex);
		expect(ts.rightOffset()).to.be.closeTo(-10, precision);
	});

	it('keeps an animated scroll on course when data arrives between frames', (t: TestContext) => {
		const start = 1000;
		const duration = 1000;
		let now = start;
		t.mock.method(performance, 'now', () => now);
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, [], model);
		ts.setBaseIndex(null);
		const timestamps = range(100);
		ts.setSlotWidths(timestamps.map((time: number) => ({ time: internalTime(time), width: 2 })));
		ts.setRightOffset(-20);
		ts.scrollToOffsetAnimated(-10, duration);
		applyFrame(ts, animations[0], start + 500);

		now = start + 505;
		ts.update(points(timestamps), 0);
		ts.setBaseIndex(99 as TimePointIndex);
		let previous = ts.rightOffset();
		expect(previous).to.be.closeTo(-15, precision);
		for (const time of [510, 750, 1000]) {
			now = start + time;
			applyFrame(ts, animations[0], now);
			expect(ts.rightOffset()).to.be.at.least(previous - precision);
			expect(ts.rightOffset()).to.be.at.most(-10 + precision);
			previous = ts.rightOffset();
		}
		expect(previous).to.be.closeTo(-10, precision);
	});

	it('keeps a spacing change made on an empty chart in the scroll position', () => {
		const model = chartModel({ rightOffsetPixels: 0, barSpacing: 6 });
		const ts = model.timeScale();
		ts.setSlotWidths([{ time: internalTime(19), width: 4 }]);
		ts.setRightOffset(-6);
		ts.setBarSpacing(12);
		expect(ts.rightOffset()).to.be.closeTo(-3, precision);
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		expect(ts.rightOffset()).to.be.closeTo(-3, precision);
	});

	it('refreshes the conflation factor when the first sizing changes the fixed-edge spacing', (t: TestContext) => {
		const globals = globalThis as { window?: unknown };
		globals.window = { devicePixelRatio: 1 };
		t.after(() => { delete globals.window; });
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, fixLeftEdge: true, fixRightEdge: true, enableConflation: true, minBarSpacing: 0.1, barSpacing: 0.5 };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		const timestamps = range(barCount);
		ts.setSlotWidths(timestamps.map((time: number) => ({ time: internalTime(time), width: minSlotWidth })));
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(timestamps), 0);
		ts.setWidth(100);
		expect(ts.barSpacing()).to.be.closeTo(5, precision);
		expect(ts.conflationFactor()).to.be.equal(1);
	});

	it('keeps following new bars when the last bar is wide and partly clipped', () => {
		const model = chartModel({ barSpacing: 6 });
		const ts = model.timeScale();
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		ts.setSlotWidths([{ time: internalTime(19), width: 10 }]);
		ts.setRightOffset(-0.3);
		for (let count = 21; count <= 23; count++) {
			model.updateTimeScale(count - 1 as TimePointIndex, points(range(count)), count - 1);
			expect(ts.rightOffset(), `${count} bars`).to.be.closeTo(-0.3, precision);
		}
	});

	it('keeps the scroll position in bars when the data is replaced', () => {
		const model = chartModel({});
		const ts = model.timeScale();
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.setSlotWidths([{ time: internalTime(barCount - 1), width: 10 }, { time: internalTime(barCount - 2), width: 4 }]);
		ts.setRightOffset(-5);
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount, 1000)), 0);
		expect(ts.rightOffset()).to.be.closeTo(-5, precision);
	});

	it('keeps following when whitespace after a wide, partly clipped last bar is filled', () => {
		const ts = createTimeScale({}, range(21));
		ts.setBaseIndex(19 as TimePointIndex);
		ts.setSlotWidths([{ time: internalTime(19), width: 10 }]);
		ts.setRightOffset(-0.3);
		// the data layer moves the base index without changing the points
		ts.setBaseIndex(20 as TimePointIndex);
		expect(ts.rightOffset()).to.be.closeTo(-0.3, precision);
	});

	it('keeps the kinetic sample when a data replace during a drag clamps the offset', () => {
		const model = chartModel({ fixLeftEdge: true, barSpacing: 6 });
		const ts = model.timeScale();
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(range(barCount)), 0);
		ts.setRightOffset(-50);
		ts.startScroll(400 as Coordinate);
		const kineticBefore = ts.kineticScrollPosition();

		const replacement = range(barCount, 1000);
		ts.updateSlotWidths(replacement.map((time: number) => ({ time: internalTime(time), width: 0.5 })));
		model.updateTimeScale(barCount - 1 as TimePointIndex, points(replacement), 0);
		expect(ts.slotRightOffset()).to.be.greaterThan(0);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
		ts.endScroll();
	});

	it('counts an animated scroll past the last bar on an empty chart in bars', (t: TestContext) => {
		const start = 1000;
		const duration = 1000;
		t.mock.method(performance, 'now', () => start);
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, [], model);
		ts.setBaseIndex(null);
		ts.setSlotWidths([{ time: internalTime(20), width: 4 }]);
		ts.scrollToOffsetAnimated(1, duration);
		applyFrame(ts, animations[0], start + duration);

		ts.update(points(range(21)), 0);
		ts.setBaseIndex(19 as TimePointIndex);
		expect(ts.rightOffset()).to.be.closeTo(1, precision);
	});

	it('moves a scrolled-back view by one bar when a wide point is inserted left of it, as without widths', () => {
		const model = chartModel({ barSpacing: 10 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(119 as TimePointIndex, points(range(120)), 0);
		ts.setRightOffset(-20);
		ts.setSlotWidths([{ time: internalTime(45.5), width: 20 }]);
		const before = ts.indexToCoordinate(99 as TimePointIndex);

		const withInsert = [...range(46), 45.5, ...range(74, 46)];
		model.updateTimeScale(120 as TimePointIndex, points(withInsert), 46);
		// time 99 is at index 100 now
		expect(ts.indexToCoordinate(100 as TimePointIndex) - before).to.be.closeTo(10, precision);
	});

	it('survives a range listener that clears the widths during a data update', () => {
		const model = chartModel({ barSpacing: 10 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(29 as TimePointIndex, points(range(30)), 0);
		ts.visibleStrictRange();
		let cleared = false;
		ts.logicalRangeChanged().subscribe(() => {
			if (!cleared) {
				cleared = true;
				ts.setSlotWidths([]);
			}
		});
		ts.setSlotWidths([{ time: internalTime(25), width: 10 }]);
		expect(() => model.updateTimeScale(30 as TimePointIndex, points(range(31)), 30)).not.to.throw();
		expect(cleared).to.be.equal(true);
		expect(ts.slotWidth(25 as TimePointIndex)).to.be.equal(ts.barSpacing());
	});

	it('keeps the kinetic sample finite after an append on a chart fitted before its first sizing', () => {
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, rightOffsetPixels: 50 };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		model.updateTimeScale(99 as TimePointIndex, points(range(100)), 0);
		ts.fitContent();
		model.updateTimeScale(100 as TimePointIndex, points(range(101)), 100);
		ts.setWidth(paneWidth);
		ts.fitContent();
		expect(Number.isFinite(ts.kineticScrollPosition())).to.be.equal(true);
	});

	it('moves the view by one bar when a wide point is inserted left of it with the last bar in view', () => {
		for (const offset of [0, 0.01, 2]) {
			const model = chartModel({ barSpacing: 10, shiftVisibleRangeOnNewBar: false });
			const ts = model.timeScale();
			model.updateTimeScale(119 as TimePointIndex, points(range(120)), 0);
			ts.setSlotWidths([{ time: internalTime(45.5), width: 20 }]);
			ts.setRightOffset(offset);
			const before = ts.indexToCoordinate(119 as TimePointIndex);

			model.updateTimeScale(120 as TimePointIndex, points([...range(46), 45.5, ...range(74, 46)]), 46);
			expect(ts.indexToCoordinate(120 as TimePointIndex) - before, `offset ${offset}`).to.be.closeTo(10, precision);
		}
	});

	it('keeps the kinetic sample when a data replace during a drag only clamps the offset', () => {
		const model = chartModel({ fixLeftEdge: true, barSpacing: 10 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(29 as TimePointIndex, points(range(30)), 0);
		ts.setSlotWidths([{ time: internalTime(0), width: 10 }]);
		ts.setRightOffset(-25);
		ts.startScroll(50 as Coordinate);
		const kineticBefore = ts.kineticScrollPosition();
		const offsetBefore = ts.slotRightOffset();

		model.updateTimeScale(29 as TimePointIndex, points(range(30, 1000)), 0);
		expect(ts.slotRightOffset()).to.be.greaterThan(offsetBefore);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
		ts.endScroll();
	});

	it('counts a nested width change from a range listener once in the kinetic sample', () => {
		const model = chartModel({ barSpacing: 10 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(119 as TimePointIndex, points(range(120)), 0);
		ts.setRightOffset(-20);
		ts.visibleStrictRange();
		ts.startScroll(50 as Coordinate);
		const kineticBefore = ts.kineticScrollPosition();
		let nested = false;
		const recalculate = model.recalculateAllPanes.bind(model);
		// stands in for a range listener, which runs while the panes update
		model.recalculateAllPanes = () => {
			recalculate();
			if (!nested) {
				nested = true;
				ts.updateSlotWidths([{ time: internalTime(115), width: 11 }]);
			}
		};
		ts.updateSlotWidths([{ time: internalTime(95), width: 5 }]);
		expect(nested).to.be.equal(true);
		expect(ts.rightOffset()).to.be.closeTo(-20, precision);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
		ts.endScroll();
	});

	it('keeps the bar under the pointer when a range listener sets the first width during a zoom', () => {
		const model = chartModel({ barSpacing: 10 }, 100);
		const ts = model.timeScale();
		model.updateTimeScale(119 as TimePointIndex, points(range(120)), 0);
		ts.setRightOffset(-20);
		ts.visibleStrictRange();
		const before = ts.coordinateToIndex(50 as Coordinate);
		let done = false;
		const recalculate = model.recalculateAllPanes.bind(model);
		// stands in for a range listener, which runs while the panes update
		model.recalculateAllPanes = () => {
			recalculate();
			if (!done) {
				done = true;
				ts.setSlotWidths([{ time: internalTime(2), width: 3 }]);
			}
		};
		ts.zoom(50 as Coordinate, 1);
		expect(done).to.be.equal(true);
		expect(Math.abs(ts.coordinateToIndex(50 as Coordinate) - before)).to.be.at.most(1);
	});

	it('counts an animated scroll in bars when the data is cleared before it ends', (t: TestContext) => {
		const start = 1000;
		const duration = 1000;
		t.mock.method(performance, 'now', () => start);
		const { model, animations } = animatedModel();
		const ts = createTimeScale({}, range(21), model);
		ts.setBaseIndex(19 as TimePointIndex);
		ts.setSlotWidths([{ time: internalTime(20), width: 4 }]);
		ts.scrollToOffsetAnimated(1, duration);
		applyFrame(ts, animations[0], start + 500);

		ts.update([], 0);
		ts.setBaseIndex(null);
		applyFrame(ts, animations[0], start + duration);
		ts.update(points(range(21)), 0);
		ts.setBaseIndex(19 as TimePointIndex);
		expect(ts.rightOffset()).to.be.closeTo(1, precision);
	});

	it('keeps a pixel margin when data arrives before the first frame of an animated scroll', () => {
		const model = chartModel({ barSpacing: 10, rightOffsetPixels: 20 });
		const ts = model.timeScale();
		ts.setSlotRightOffset(20 / ts.barSpacing());
		ts.setSlotWidths([{ time: internalTime(20), width: 4 }]);
		ts.scrollToOffsetAnimated(1, 1000);
		model.updateTimeScale(19 as TimePointIndex, points(range(21)), 0);
		expect(marginAtBase(ts)).to.be.closeTo(20, precision);
	});

	it('keeps a logical range set on an empty chart over the right offset option', () => {
		const model = chartModel({ rightOffset: -3 });
		const ts = model.timeScale();
		ts.setSlotWidths([{ time: internalTime(19), width: 10 }]);
		ts.setVisibleRange(new RangeImpl(-30 as TimePointIndex, -6 as TimePointIndex));
		model.updateTimeScale(19 as TimePointIndex, points(range(20)), 0);
		expect(ts.rightOffset()).to.be.closeTo(-6, precision);
	});

	it('reports an unparseable time as a RangeError through the API', () => {
		const model = modelMock();
		const ts = createTimeScale({}, range(barCount), model);
		model.timeScale = () => ts;
		const axis = { sizeChanged: () => new Delegate<number, number>() } as unknown as TimeAxisWidget<Time>;
		const api = new TimeScaleApi(model, axis, behavior);
		api.setSlotWidths([{ time: 0 as UTCTimestamp, width: 2 }]);
		expect(() => api.setSlotWidths([{ time: 'not a date', width: 3 }])).to.throw(RangeError);
		expect(ts.slotWidth(0 as TimePointIndex)).to.be.equal(2 * ts.barSpacing());
	});

	it('applies a width supplied before its time point exists', () => {
		const ts = createTimeScale();
		ts.updateSlotWidths([{ time: internalTime(barCount), width: 2 }]);
		ts.update(points(range(barCount + 1)), barCount);
		expect(ts.slotWidth(barCount as TimePointIndex)).to.be.equal(2 * ts.barSpacing());
	});

	it('clamps extreme widths and rejects invalid ones without changing state', () => {
		const ts = createTimeScale();
		ts.setSlotWidths([{ time: internalTime(0), width: 1e-9 }, { time: internalTime(1), width: 1e9 }]);
		expect(ts.slotWidth(0 as TimePointIndex)).to.be.closeTo(minSlotWidth * ts.barSpacing(), precision);
		expect(ts.slotWidth(1 as TimePointIndex)).to.be.closeTo(maxSlotWidth * ts.barSpacing(), precision);

		for (const invalid of [0, -1, NaN, Infinity]) {
			expect(() => ts.updateSlotWidths([{ time: internalTime(2), width: 3 }, { time: internalTime(3), width: invalid }])).to.throw(RangeError);
		}
		expect(ts.slotWidth(2 as TimePointIndex)).to.be.equal(ts.barSpacing());

		ts.setSlotWidths([{ time: internalTime(0), width: 2 }]);
		expect(() => ts.setSlotWidths([{ time: internalTime(NaN), width: 2 }])).to.throw(RangeError);
		expect(ts.slotWidth(0 as TimePointIndex)).to.be.equal(2 * ts.barSpacing());
	});

	it('accepts widths on an empty time scale', () => {
		const ts = new TimeScale<Time>(modelMock(), timeScaleOptionsDefaults, localization, behavior);
		ts.setSlotWidths(slotWidths(range(10)));
		expect(ts.visibleLogicalRange()).to.be.equal(null);
		ts.setWidth(paneWidth);
		ts.update(points(range(10)), 0);
		ts.setBaseIndex(9 as TimePointIndex);
		expect(ts.slotWidth(2 as TimePointIndex)).to.be.closeTo(widthFor(2) * ts.barSpacing(), precision);
	});

	it('uses valid slot widths in the guide and API examples for zero-volume bars', () => {
		const guide = readFileSync(new URL('../../website/docs/slot-widths.md', import.meta.url), 'utf8');
		const api = readFileSync(new URL('../../src/api/itime-scale-api.ts', import.meta.url), 'utf8');
		const guideExample = guide.match(/```javascript\r?\n([\s\S]*?)```/)?.[1];
		const apiExample = api.slice(api.indexOf('Replaces the relative slot widths')).match(/```js\r?\n([\s\S]*?)```/)?.[1]
			.replace(/^\s*\* ?/gm, '');
		expect(guideExample).to.be.a('string');
		expect(apiExample).to.be.a('string');

		const checkWidths = (widths: { width: number }[]) => {
			for (const { width } of widths) {
				normalizeSlotWidth(width);
			}
		};
		const chart = { timeScale: () => ({ setSlotWidths: checkWidths, updateSlotWidths: checkWidths }) };
		const series = { setData: () => {}, update: () => {} };
		for (const volume of [100, 0]) {
			const bars = [{ time: 0, volume: 0 }, { time: 1, volume }];
			const context = { bars, averageVolume: volume / bars.length, lastBar: bars[0], chart, series };
			runInNewContext(guideExample ?? '', { ...context });
			runInNewContext(apiExample ?? '', { ...context });
		}
	});

	it('constrains spacing against the new base after prepending slots', () => {
		const timestamps = range(20, 10);
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, fixLeftEdge: true, fixRightEdge: true };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		const history = range(10);
		model.updateTimeScale(timestamps.length - 1 as TimePointIndex, points(timestamps), 0);
		ts.setSlotWidths([
			...timestamps.map((time: number) => ({ time: internalTime(time), width: 4 })),
			...history.map((time: number) => ({ time: internalTime(time), width: minSlotWidth })),
		]);
		ts.setWidth(paneWidth);
		ts.fitContent();
		const spacing = ts.barSpacing();
		const prepended = [...history, ...timestamps];

		model.updateTimeScale(prepended.length - 1 as TimePointIndex, points(prepended), 0);
		expect(ts.barSpacing()).to.be.closeTo(spacing, precision);
		expect(ts.visibleLogicalRange()?.left()).to.be.closeTo(history.length, precision);
	});

	it('publishes one visible range for a combined prepend and base update', () => {
		const timestamps = range(20, 10);
		const history = range(10);
		const options = chartOptionsDefaults<Time>();
		options.timeScale = { ...options.timeScale, fixLeftEdge: true, fixRightEdge: true };
		const model = new ChartModel<Time>(() => {}, options, behavior);
		const ts = model.timeScale();
		ts.setWidth(paneWidth);
		ts.setSlotWidths([
			...timestamps.map((time: number) => ({ time: internalTime(time), width: 4 })),
			...history.map((time: number) => ({ time: internalTime(time), width: minSlotWidth })),
		]);
		model.updateTimeScale(timestamps.length - 1 as TimePointIndex, points(timestamps), 0);
		ts.fitContent();
		ts.visibleLogicalRange();
		const changes: number[][] = [];
		ts.logicalRangeChanged().subscribe(() => {
			const visible = ts.visibleLogicalRange();
			if (visible !== null) {
				changes.push([visible.left(), visible.right()]);
			}
		});
		const prepended = [...history, ...timestamps];

		model.updateTimeScale(prepended.length - 1 as TimePointIndex, points(prepended), 0);
		ts.visibleLogicalRange();
		expect(changes).to.deep.equal([[history.length, prepended.length - 1]]);
	});

	it('keeps both logical edges on locked resize with a pixel margin', () => {
		const model = modelMock();
		model.setRightOffset = () => {};
		const ts = createTimeScale({ lockVisibleTimeRangeOnResize: true, rightOffsetPixels: 60 }, range(barCount), model);
		ts.setSlotWidths([{ time: internalTime(barCount - 1), width: 2 }]);
		ts.restoreDefault();
		const before = ts.visibleLogicalRange();

		ts.setWidth(paneWidth * 2);
		expect(ts.visibleLogicalRange()?.left()).to.be.closeTo(before?.left() ?? NaN, precision);
		expect(ts.visibleLogicalRange()?.right()).to.be.closeTo(before?.right() ?? NaN, precision);
		expect(marginAtBase(ts)).to.be.closeTo(120, precision);
	});

	it('snaps across whitespace to the closest populated slot in pixels', () => {
		const model = modelMock();
		const series = { fulfilledIndices: () => [0, 2] } as unknown as Series<'Line'>;
		model.serieses = () => [series];
		const ts = createTimeScale({ ignoreWhitespaceIndices: true }, range(3), model);
		ts.setSlotWidths([{ time: internalTime(0), width: maxSlotWidth }]);
		const whitespaceCenter = ts.indexToCoordinate(1 as TimePointIndex);

		expect(ts.coordinateToIndex(whitespaceCenter, true)).to.equal(2);
	});

	it('stops the whitespace search at the nearest populated slot', () => {
		const count = 5000;
		const model = modelMock();
		const series = { fulfilledIndices: () => [0, count - 1] } as unknown as Series<'Line'>;
		model.serieses = () => [series];
		const ts = createTimeScale({ ignoreWhitespaceIndices: true, barSpacing: 1 }, range(count), model);
		ts.setSlotWidths([{ time: internalTime(count - 1), width: 2 }]);
		ts.setRightOffset(-(count - 400));
		let steps = 0;
		const indexToCoordinate = ts.indexToCoordinate.bind(ts);
		ts.indexToCoordinate = (index: TimePointIndex) => { steps++; return indexToCoordinate(index); };

		expect(ts.coordinateToIndex(indexToCoordinate(1 as TimePointIndex), true)).to.equal(0);
		expect(steps).to.be.lessThan(10);
	});
});

describe('TickMarks with slot widths', () => {
	it('rebuilds ticks when a replacement layout has the same revision', () => {
		const tickMarks = new TickMarks<Time>();
		tickMarks.setTimeScalePoints(points(range(40)), 0);
		const wide = new SlotLayout();
		const narrow = new SlotLayout();
		wide.update(40, 0, () => 4);
		narrow.update(40, 0, () => 0.1);

		expect(tickMarks.build(10, 40, false, new Map(), 0, wide)).to.have.length(40);
		expect(tickMarks.build(10, 40, false, new Map(), 0, narrow)).to.have.length(1);
	});

	it('measures label distance in slot units', () => {
		const timestamps = range(40);
		const tickMarks = new TickMarks<Time>();
		tickMarks.setTimeScalePoints(points(timestamps), 0);

		const uniform = tickMarks.build(10, 40, false, new Map(), 0);
		// every index is 4 slots from its neighbour, so a 4-index label width fits every mark
		const layout = new SlotLayout();
		layout.update(timestamps.length, 0, () => 4);
		const wide = tickMarks.build(10, 40, false, new Map(), 0, layout);

		expect(uniform.length).to.be.equal(10);
		expect(wide.length).to.be.equal(timestamps.length);
	});
});

describe('Singleton line with slot widths', () => {
	it('draws and hit tests the segment using the point’s slot width', () => {
		const ts = createTimeScale();
		const time = 10 as TimePointIndex;
		ts.setSlotWidths([{ time: internalTime(time), width: 4 }]);
		const x = 100 as Coordinate;
		const y = 50 as Coordinate;
		const path: number[] = [];
		const context = {
			save: () => {},
			restore: () => {},
			setTransform: () => {},
			beginPath: () => {},
			setLineDash: () => {},
			moveTo: (pointX: number) => { path.push(pointX); },
			lineTo: (pointX: number) => { path.push(pointX); },
			stroke: () => {},
		} as unknown as CanvasRenderingContext2D;
		const dimensions = size({ width: paneWidth, height: 100 });
		const target = new CanvasRenderingTarget2D(context, dimensions, dimensions);
		class SingletonView extends SeriesLinePaneView {
			protected override _makeValid(): void {
				this._items = [{ time, price: 0 as BarPrice, x, y, lineColor: 'black' }];
				this._itemsVisibleRange = { from: 0, to: 1 };
				this._prepareRendererData();
			}
		}
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
		const series = { visible: () => true, options: () => ({ lineVisible: true, lineType: LineType.Simple, lineWidth: 1, lineStyle: LineStyle.Solid }) } as ISeries<'Line'>;
		const model = modelMock();
		model.timeScale = () => ts;
		const view = new SingletonView(series, model);

		view.renderer()?.draw(target, false);
		expect(path).to.deep.equal([88, 112]);
		expect(view.hitTest(110, y)).to.not.equal(null);
		expect(view.hitTest(114, y)).to.equal(null);
	});
});
