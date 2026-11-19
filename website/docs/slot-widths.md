---
sidebar_position: 6
---

# Slot widths

By default every time point on the [time scale](/time-scale.md) gets the same horizontal space, `barSpacing` pixels wide.
That space is the time point's **slot**. You can give individual time points wider or narrower slots,
for example to draw heavy-volume candles wider than quiet ones.

The chart only honours the widths you supply; your application decides what they mean.

## Setting widths

A slot width is relative to the default slot: `1` is the default, `2` is twice as wide and `0.5` is half as wide.
The slot's pixel width is `width * barSpacing`.

Use [`ITimeScaleApi.setSlotWidths`](/api/interfaces/ITimeScaleApi.md#setslotwidths) to replace all widths,
and [`ITimeScaleApi.updateSlotWidths`](/api/interfaces/ITimeScaleApi.md#updateslotwidths) to change only some of them:

```javascript
const averageVolume = bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length || 1;
const minWidth = 0.1;
const widthFor = bar => Math.max(minWidth, Math.sqrt(bar.volume / averageVolume));

series.setData(bars);
chart.timeScale().setSlotWidths(bars.map(bar => ({ time: bar.time, width: widthFor(bar) })));

// a live, still-forming bar
series.update(lastBar);
chart.timeScale().updateSlotWidths([{ time: lastBar.time, width: widthFor(lastBar) }]);
```

Widths are matched to time points by `time`, not by index. A width therefore stays with its time point when
you prepend older history or insert whitespace points, and you can supply a width before its time point exists.
To load history at the left edge, call `updateSlotWidths` with the widths of the new bars only.

## Behaviour

- **Opt-in.** Until a width other than `1` is set, the chart behaves exactly as without this feature.
  `setSlotWidths([])` returns to uniform spacing.
- **Missing widths.** Time points without a width, whitespace points included, use the default width `1`.
  So does the empty space before the first and after the last time point, including the right offset.
- **Limits.** A width must be a finite number above `0` and its time must be valid; otherwise the call throws a
  `RangeError` and changes nothing. Valid widths are clamped to the range `[0.1, 20]`.
- **Stored widths.** A width is kept until you replace it, also for times that are not on the time scale.
  `setSlotWidths` discards every earlier width, so use it to drop widths of data you no longer show.
- **One width per time point.** Widths belong to the time scale, so they apply to every series and every pane.
- **Zooming** changes `barSpacing`, the width of a default slot, and scales all slots together.
- **Units.** Logical indices and ranges still count time points, so `setVisibleLogicalRange({ from: 10, to: 20 })`
  shows the 11 slots from index 10 to 20, whatever their widths. `scrollPosition()` and `rightOffset` are measured in bars.
- **Scrolling, kinetic scrolling, zooming, fit-content, tick marks, the crosshair and hit testing** all use the slot positions.
- **Changing a width** keeps the view steady. While the right edge of the last bar is in view, its distance to the
  right edge of the chart is kept, so a growing live bar pushes history to the left. When you have scrolled back,
  the bars at the right edge of the chart stay where they are.

## Series

Candlestick, bar and histogram series size each bar to its slot, using the same proportions they use for `barSpacing`.
Line, area and baseline series place their points at the slot centres.

Data conflation is computed from `barSpacing`; a conflated point is drawn in the slot of the time point it represents.

## Plugins

[`ITimeScaleApi.logicalToCoordinate`](/api/interfaces/ITimeScaleApi.md#logicaltocoordinate) returns a slot's centre and
[`ITimeScaleApi.slotWidth`](/api/interfaces/ITimeScaleApi.md#slotwidth) its width in pixels, so a series primitive can
align a shape with a slot:

```javascript
const x = chart.timeScale().logicalToCoordinate(logical);
const width = chart.timeScale().slotWidth(logical);
// the slot spans x - width / 2 .. x + width / 2
```

Custom series receive each bar's slot width as [`CustomBarItemData.slotWidth`](/api/interfaces/CustomBarItemData.md#slotwidth).
The chart always sets it; it is optional in the type only so that objects you build yourself stay valid.
