/* eslint-disable @typescript-eslint/no-floating-promises */
import { expect } from 'chai';
import { describe, it } from 'node:test';

import { timeScaleOptionsDefaults } from '../../src/api/options/time-scale-options-defaults';
import { ChartModel } from '../../src/model/chart-model';
import { Coordinate } from '../../src/model/coordinate';
import { HorzScaleBehaviorTime } from '../../src/model/horz-scale-behavior-time/horz-scale-behavior-time';
import { Time, UTCTimestamp } from '../../src/model/horz-scale-behavior-time/types';
import { InternalHorzScaleItem } from '../../src/model/ihorz-scale-behavior';
import { LocalizationOptions } from '../../src/model/localization-options';
import { maxSlotWidth, minSlotWidth, SlotLayout } from '../../src/model/slot-layout';
import { TickMarks } from '../../src/model/tick-marks';
import { Logical, TickMarkWeightValue, TimePointIndex, TimeScalePoint } from '../../src/model/time-data';
import { HorzScaleOptions, InternalSlotWidth, TimeScale } from '../../src/model/time-scale';

const behavior = new HorzScaleBehaviorTime();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localization: LocalizationOptions<Time> = {} as any;
const precision = 1e-6;
const paneWidth = 800;
const barCount = 200;

function modelMock(): ChartModel<Time> {
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	return { recalculateAllPanes: () => {}, lightUpdate: () => {} } as ChartModel<Time>;
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

function createTimeScale(options: Partial<HorzScaleOptions> = {}, timestamps: readonly number[] = range(barCount)): TimeScale<Time> {
	const ts = new TimeScale<Time>(modelMock(), { ...timeScaleOptionsDefaults, barSpacing: 6, rightOffset: 0, ...options }, localization, behavior);
	ts.setWidth(paneWidth);
	ts.update(points(timestamps), 0);
	ts.setBaseIndex(timestamps.length - 1 as TimePointIndex);
	return ts;
}

function coordinates(ts: TimeScale<Time>, count: number): number[] {
	return range(count).map((i: number) => ts.indexToCoordinate(i as TimePointIndex));
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

	it('zoom keeps the point under the cursor in place', () => {
		const ts = createTimeScale();
		ts.setSlotWidths(slotWidths(range(barCount)));
		const zoomPoint = 300 as Coordinate;
		const index = ts.coordinateToIndex(zoomPoint);
		const before = ts.indexToCoordinate(index);
		ts.zoom(zoomPoint, 3);
		expect(ts.indexToCoordinate(index)).to.be.closeTo(zoomPoint + (before - zoomPoint) * ts.barSpacing() / 6, precision);
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
		ts.setBaseIndex(barCount as TimePointIndex);
		const slotShift = ts.shiftRightOffset(1);

		coordinates(ts, barCount).forEach((x: number, i: number) => expect(x).to.be.closeTo(before[i], precision));
		// slot offsets are measured from the base bar's right edge, which moved by the new bar's width
		expect(slotShift).to.be.closeTo(widthFor(barCount), precision);
		expect(ts.kineticScrollPosition()).to.be.closeTo(kineticBefore, precision);
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
});

describe('TickMarks with slot widths', () => {
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
