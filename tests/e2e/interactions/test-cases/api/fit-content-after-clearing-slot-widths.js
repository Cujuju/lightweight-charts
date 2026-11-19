async function beforeInteractions(container) {
	const width = 80;
	const height = 200;
	const chart = LightweightCharts.createChart(container, {
		width: 400,
		height,
		rightPriceScale: { visible: false },
		timeScale: { rightOffsetPixels: width, minBarSpacing: 0 },
	});

	try {
		const data = Array.from({ length: 10 }, (_, time) => ({ time, value: time }));
		chart.addSeries(LightweightCharts.LineSeries).setData(data);
		const timeScale = chart.timeScale();
		timeScale.setSlotWidths(data.map(({ time }) => ({ time, width: 2 })));
		chart.resize(0, height, true);

		timeScale.fitContent();
		timeScale.setSlotWidths([]);
		chart.resize(width, height, true);

		const range = timeScale.getVisibleLogicalRange();
		if (range === null || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > 0 || range.to < data.length - 1) {
			throw new Error('The queued fit should keep all data visible after revealing the pane.');
		}
	} finally {
		chart.remove();
	}
}

function initialInteractionsToPerform() {
	return [];
}

function finalInteractionsToPerform() {
	return [];
}

function afterFinalInteractions() {
	return Promise.resolve();
}
