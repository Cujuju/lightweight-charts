/**
 * Smallest accepted relative slot width. Above zero so every bar keeps a hit-testable, labelable slot.
 */
export const minSlotWidth = 0.1;

/**
 * Largest accepted relative slot width. Bounds the hit-test search window and tick label spacing.
 */
export const maxSlotWidth = 20;

/** Relative width of a slot without an explicit width, and of every slot outside the data. */
export const defaultSlotWidth = 1;

/** Doubling keeps appends amortised O(1). */
const capacityGrowthFactor = 2;

/**
 * Validates a relative slot width and clamps it into [{@link minSlotWidth}, {@link maxSlotWidth}].
 *
 * @throws RangeError if the width is not a finite positive number.
 */
export function normalizeSlotWidth(width: number): number {
	if (!Number.isFinite(width) || width <= 0) {
		throw new RangeError(`slot width must be a finite positive number, got ${width}`);
	}
	return Math.min(maxSlotWidth, Math.max(minSlotWidth, width));
}

/**
 * Maps logical indices to "slot units", where bar `i` covers `[start(i), start(i) + width(i))`.
 * Logical `i - 0.5 .. i + 0.5` maps linearly onto that interval.
 * Indices outside `[0, count)` use {@link defaultSlotWidth}, so `start(i) === i` for `i <= 0`.
 */
export class SlotLayout {
	// Both arrays keep spare capacity so appending a slot does not copy the history.
	private _widths: Float64Array = new Float64Array(0);
	// _starts[i] = sum of _widths[0..i); valid for i <= count
	private _starts: Float64Array = new Float64Array(1);
	private _count: number = 0;
	private _maxWidth: number = defaultSlotWidth;
	private _revision: number = 0;

	public count(): number {
		return this._count;
	}

	/** Increments on every change; used as a cache key. */
	public revision(): number {
		return this._revision;
	}

	/** Largest width in the layout, at least {@link defaultSlotWidth}. */
	public maxWidth(): number {
		return this._maxWidth;
	}

	/**
	 * Resizes to `count` slots and rewrites the widths from `fromIndex` on using `widthAt`.
	 * Cost is O(count - fromIndex), plus O(count) only when the widest slot was rewritten to something narrower.
	 */
	public update(count: number, fromIndex: number, widthAt: (index: number) => number): void {
		// slots past the old length have no width yet, so they are always rewritten
		const rewriteFrom = Math.max(0, Math.min(fromIndex, this._count, count));
		this._reserve(count, rewriteFrom);

		let rewrittenMax = defaultSlotWidth;
		let widestRewritten = false;
		for (let i = rewriteFrom; i < count; i++) {
			widestRewritten ||= i < this._count && this._widths[i] === this._maxWidth;
			const width = widthAt(i);
			this._widths[i] = width;
			this._starts[i + 1] = this._starts[i] + width;
			rewrittenMax = Math.max(rewrittenMax, width);
		}
		widestRewritten ||= count < this._count;
		this._count = count;

		if (rewrittenMax >= this._maxWidth) {
			this._maxWidth = rewrittenMax;
		} else if (widestRewritten) {
			let max = rewrittenMax;
			for (let i = 0; i < rewriteFrom; i++) {
				max = Math.max(max, this._widths[i]);
			}
			this._maxWidth = max;
		}
		this._revision++;
	}

	public width(index: number): number {
		return index >= 0 && index < this._count ? this._widths[index] : defaultSlotWidth;
	}

	/** Slot-unit position of the left edge of the slot with integer `index`. */
	public start(index: number): number {
		const count = this._count;
		if (index <= 0) {
			return index * defaultSlotWidth;
		}
		if (index >= count) {
			return this._starts[count] + (index - count) * defaultSlotWidth;
		}
		return this._starts[index];
	}

	public center(index: number): number {
		return this.start(index) + this.width(index) / 2;
	}

	public logicalToSlot(logical: number): number {
		const index = Math.floor(logical + 0.5);
		return this.start(index) + (logical - index + 0.5) * this.width(index);
	}

	public slotToLogical(slot: number): number {
		const count = this._count;
		const total = this._starts[count];
		if (slot < 0 || count === 0) {
			return slot / defaultSlotWidth - 0.5;
		}
		if (slot >= total) {
			return count + (slot - total) / defaultSlotWidth - 0.5;
		}

		// binary search for the last index whose start is <= slot
		let low = 0;
		let high = count - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (this._starts[mid] <= slot) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return low - 0.5 + (slot - this._starts[low]) / this._widths[low];
	}

	/** Grows the arrays to hold `count` slots, keeping the first `keep` of them. */
	private _reserve(count: number, keep: number): void {
		if (count <= this._widths.length) {
			return;
		}
		const capacity = Math.max(count, this._widths.length * capacityGrowthFactor);
		const widths = new Float64Array(capacity);
		widths.set(this._widths.subarray(0, keep));
		const starts = new Float64Array(capacity + 1);
		starts.set(this._starts.subarray(0, keep + 1));
		this._widths = widths;
		this._starts = starts;
	}
}
