# Variable width candles

Sizes each candle's slot on the time scale from its volume, using
`ITimeScaleApi.setSlotWidths` and `ITimeScaleApi.updateSlotWidths`.

- `variable-width-candles.ts`: `VariableWidthCandles` keeps a candlestick
  series and the slot widths in step for full loads, live updates and history
  prepended at the left edge. The width is
  `(volume / medianVolume) ^ 0.5`, clamped to `[0.6, 3]` (see
  `defaultVolumeWeighting`).
- `slot-boxes.ts`: `SlotBoxes`, a series primitive that draws a high-low box
  across each visible candle's slot. It reads the slot centre with
  `logicalToCoordinate` and its width with `slotWidth`.

See [Slot widths](../../../../website/docs/slot-widths.md) for the API.
