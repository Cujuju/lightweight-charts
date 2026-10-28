# Modifications

This is a fork of [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts)
(Apache-2.0; see `LICENSE` and `NOTICE`). It is not an official TradingView release.

## Pane visibility (2026, Cujuju)

Adds `IPaneApi.setVisible(visible)` and `IPaneApi.visible()`. A hidden pane takes no height and no
separator; the visible panes share the chart's height, and the pane keeps its series, price scales
and stretch factor so showing it again restores its size.

Changed files:

- `src/model/pane.ts` — visibility state
- `src/model/chart-model.ts` — `changePanesHeight` distributes among visible panes only
- `src/gui/chart-widget.ts` — layout, `paneSize` and screenshots skip hidden panes and their separators
- `src/gui/pane-separator.ts` — separator visibility; resizes against the nearest visible pane above
- `src/api/pane-api.ts`, `src/api/ipane-api.ts` — public API

Tests: `tests/e2e/interactions/test-cases/api/pane-visibility.js`,
`tests/e2e/graphics/test-cases/panes/hidden-pane.js`, `tests/e2e/coverage/test-cases/panes/pane-api.js`.

## Last pane takes the exact remaining height (2026, Cujuju)

The last visible pane's height was rounded up to a whole device pixel, so at fractional pixel ratios
(125%, 150%) the panes overshot the chart by up to a device pixel and the time axis moved whenever the
number of visible panes changed. It now takes the exact remainder, so panes, separators and the time
axis always sum to the chart height.

Changed files:

- `src/gui/chart-widget.ts` — `_adjustSizeImpl`
