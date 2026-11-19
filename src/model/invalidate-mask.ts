import { InternalHorzScaleItem } from './ihorz-scale-behavior';
import { IRange, LogicalRange } from './time-data';

export const enum InvalidationLevel {
	None = 0,
	Cursor = 1,
	Light = 2,
	Full = 3,
}

export interface PaneInvalidation {
	level: InvalidationLevel;
	autoScale?: boolean;
}

function mergePaneInvalidation(beforeValue: PaneInvalidation | undefined, newValue: PaneInvalidation): PaneInvalidation {
	if (beforeValue === undefined) {
		return newValue;
	}
	const level = Math.max(beforeValue.level, newValue.level);
	const autoScale = beforeValue.autoScale || newValue.autoScale;
	return { level, autoScale };
}

export const enum TimeScaleInvalidationType {
	FitContent,
	ApplyRange,
	ApplyBarSpacing,
	ApplyRightOffset,
	Reset,
	Animation,
	StopAnimation,
}

export type TimeScaleRange = (LogicalRange & { time?: undefined }) | { time: IRange<InternalHorzScaleItem>; logical?: LogicalRange };

export interface TimeScaleApplyRangeInvalidation {
	type: TimeScaleInvalidationType.ApplyRange;
	value: TimeScaleRange;
}

export interface TimeScaleFitContentInvalidation {
	type: TimeScaleInvalidationType.FitContent;
	slotFitRequested: boolean;
}

export interface TimeScaleApplyRightOffsetInvalidation {
	type: TimeScaleInvalidationType.ApplyRightOffset;
	value: number | undefined;
	offsetPixels?: number;
}

export interface TimeScaleApplyBarSpacingInvalidation {
	type: TimeScaleInvalidationType.ApplyBarSpacing;
	value: number;
	revalidate?: boolean;
}

export interface TimeScaleResetInvalidation {
	type: TimeScaleInvalidationType.Reset;
}

/** A destination with no bar offset resolves in pixels, even in a uniform layout. */
export type TimeScaleAnimationDestination = { bars: number; pixels?: number } | { bars?: undefined; pixels: number };

export interface ITimeScaleAnimation {
	getPosition(time: number): number;
	finished(time: number): boolean;
	readonly destination?: TimeScaleAnimationDestination;
	/**
	 * Shifts the positions this animation produces by `delta` bars to the left,
	 * so a right offset shift during the animation is not undone on the next frame.
	 */
	shift(delta: number): void;
}
export interface StartTimeScaleAnimationInvalidation {
	type: TimeScaleInvalidationType.Animation;
	value: ITimeScaleAnimation;
}

export interface StopTimeScaleAnimationInvalidation {
	type: TimeScaleInvalidationType.StopAnimation;
}

export type TimeScaleInvalidation =
	| TimeScaleApplyRangeInvalidation
	| TimeScaleFitContentInvalidation
	| TimeScaleApplyRightOffsetInvalidation
	| TimeScaleApplyBarSpacingInvalidation
	| TimeScaleResetInvalidation
	| StartTimeScaleAnimationInvalidation
	| StopTimeScaleAnimationInvalidation;

export class InvalidateMask {
	private _invalidatedPanes: Map<number, PaneInvalidation> = new Map();
	private _globalLevel: InvalidationLevel;
	private _timeScaleInvalidations: TimeScaleInvalidation[] = [];

	public constructor(globalLevel: InvalidationLevel) {
		this._globalLevel = globalLevel;
	}

	public invalidatePane(paneIndex: number, invalidation: PaneInvalidation): void {
		const prevValue = this._invalidatedPanes.get(paneIndex);
		const newValue = mergePaneInvalidation(prevValue, invalidation);
		this._invalidatedPanes.set(paneIndex, newValue);
	}

	public fullInvalidation(): InvalidationLevel {
		return this._globalLevel;
	}

	public invalidateForPane(paneIndex: number): PaneInvalidation {
		const paneInvalidation = this._invalidatedPanes.get(paneIndex);
		if (paneInvalidation === undefined) {
			return {
				level: this._globalLevel,
			};
		}
		return {
			level: Math.max(this._globalLevel, paneInvalidation.level),
			autoScale: paneInvalidation.autoScale,
		};
	}

	public setFitContent(slotFitRequested: boolean): void {
		this.stopTimeScaleAnimation();
		// modifies both bar spacing and right offset
		this._timeScaleInvalidations = [{ type: TimeScaleInvalidationType.FitContent, slotFitRequested }];
	}

	public applyRange(range: TimeScaleRange): void {
		this.stopTimeScaleAnimation();
		// modifies both bar spacing and right offset
		this._timeScaleInvalidations = [{ type: TimeScaleInvalidationType.ApplyRange, value: range }];
	}

	public setTimeScaleAnimation(animation: ITimeScaleAnimation): void {
		this._removeTimeScaleAnimation();
		this._timeScaleInvalidations.push({ type: TimeScaleInvalidationType.Animation, value: animation });
	}

	public stopTimeScaleAnimation(): void {
		this._removeTimeScaleAnimation();
		this._timeScaleInvalidations.push({ type: TimeScaleInvalidationType.StopAnimation });
	}

	public resetTimeScale(): void {
		this.stopTimeScaleAnimation();
		// modifies both bar spacing and right offset
		this._timeScaleInvalidations = [{ type: TimeScaleInvalidationType.Reset }];
	}

	public setBarSpacing(barSpacing: number, revalidate?: boolean): void {
		this.stopTimeScaleAnimation();
		this._timeScaleInvalidations.push({ type: TimeScaleInvalidationType.ApplyBarSpacing, value: barSpacing, revalidate });
	}

	public setRightOffset(offset: number | undefined, offsetPixels?: number): void {
		this.stopTimeScaleAnimation();
		this._timeScaleInvalidations.push({ type: TimeScaleInvalidationType.ApplyRightOffset, value: offset, offsetPixels });
	}

	public timeScaleInvalidations(): readonly TimeScaleInvalidation[] {
		return this._timeScaleInvalidations;
	}

	public merge(other: InvalidateMask): void {
		for (const tsInvalidation of other._timeScaleInvalidations) {
			this._applyTimeScaleInvalidation(tsInvalidation);
		}

		this._globalLevel = Math.max(this._globalLevel, other._globalLevel);
		other._invalidatedPanes.forEach((invalidation: PaneInvalidation, index: number) => {
			this.invalidatePane(index, invalidation);
		});
	}

	public static light(): InvalidateMask {
		return new InvalidateMask(InvalidationLevel.Light);
	}

	public static full(): InvalidateMask {
		return new InvalidateMask(InvalidationLevel.Full);
	}

	private _applyTimeScaleInvalidation(invalidation: TimeScaleInvalidation): void {
		switch (invalidation.type) {
			case TimeScaleInvalidationType.FitContent:
				this.setFitContent(invalidation.slotFitRequested);
				break;
			case TimeScaleInvalidationType.ApplyRange:
				this.applyRange(invalidation.value);
				break;
			case TimeScaleInvalidationType.ApplyBarSpacing:
				this.setBarSpacing(invalidation.value, invalidation.revalidate);
				break;
			case TimeScaleInvalidationType.ApplyRightOffset:
				this.setRightOffset(invalidation.value, invalidation.offsetPixels);
				break;
			case TimeScaleInvalidationType.Reset:
				this.resetTimeScale();
				break;
			case TimeScaleInvalidationType.Animation:
				this.setTimeScaleAnimation(invalidation.value);
				break;
			case TimeScaleInvalidationType.StopAnimation:
				this._removeTimeScaleAnimation();
		}
	}

	private _removeTimeScaleAnimation(): void {
		const index = this._timeScaleInvalidations.findIndex((inv: TimeScaleInvalidation) => inv.type === TimeScaleInvalidationType.Animation);
		if (index !== -1) {
			this._timeScaleInvalidations.splice(index, 1);
		}
	}
}
