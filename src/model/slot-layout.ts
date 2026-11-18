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
	private _widths: Float64Array = new Float64Array(0);
	// _starts[i] = sum of _widths[0..i); length is count + 1
	private _starts: Float64Array = new Float64Array(1);
	private _maxWidth: number = defaultSlotWidth;
	private _revision: number = 0;

	public count(): number {
		return this._widths.length;
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
	 * Cost is O(count) for the max scan plus O(count - fromIndex) for the rest.
	 */
	public update(count: number, fromIndex: number, widthAt: (index: number) => number): void {
		// slots past the old length have no width yet, so they are always rewritten
		const rewriteFrom = Math.max(0, Math.min(fromIndex, this._widths.length, count));
		let startsFrom = rewriteFrom;
		if (count !== this._widths.length) {
			const widths = new Float64Array(count);
			widths.set(this._widths.subarray(0, rewriteFrom));
			this._widths = widths;
			this._starts = new Float64Array(count + 1);
			startsFrom = 0;
		}
		for (let i = rewriteFrom; i < count; i++) {
			this._widths[i] = widthAt(i);
		}

		let max = defaultSlotWidth;
		for (let i = 0; i < count; i++) {
			max = Math.max(max, this._widths[i]);
		}
		for (let i = startsFrom; i < count; i++) {
			this._starts[i + 1] = this._starts[i] + this._widths[i];
		}
		this._maxWidth = max;
		this._revision++;
	}

	public width(index: number): number {
		return index >= 0 && index < this._widths.length ? this._widths[index] : defaultSlotWidth;
	}

	/** Slot-unit position of the left edge of the slot with integer `index`. */
	public start(index: number): number {
		const count = this._widths.length;
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
		const count = this._widths.length;
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
}
