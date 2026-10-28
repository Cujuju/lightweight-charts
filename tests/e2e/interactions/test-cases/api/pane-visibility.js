function simpleData(base) {
	return [
		{ time: '2020-01-01', value: base },
		{ time: '2020-01-02', value: base + 4 },
		{ time: '2020-01-03', value: base + 2 },
	];
}

function initialInteractionsToPerform() {
	return [];
}

function finalInteractionsToPerform() {
	return [];
}

let chart = null;

function nextFrame() {
	return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function check(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function rowHeights() {
	return Array.from(chart.chartElement().querySelectorAll('table > tr'))
		.filter(tr => getComputedStyle(tr).display !== 'none')
		.map(tr => tr.getBoundingClientRect().height);
}

function visibleSeparatorCount() {
	return Array.from(chart.chartElement().querySelectorAll('table > tr'))
		.filter(tr => tr.getBoundingClientRect().height === 1 && getComputedStyle(tr).display !== 'none')
		.length;
}

function timeAxisTop() {
	const rows = chart.chartElement().querySelectorAll('table > tr');
	return rows[rows.length - 1].getBoundingClientRect().top;
}

function beforeInteractions(container) {
	chart = LightweightCharts.createChart(container, { layout: { attributionLogo: false } });
	chart.addSeries(LightweightCharts.LineSeries).setData(simpleData(10));
	chart.addSeries(LightweightCharts.LineSeries, {}, 1).setData(simpleData(20));
	chart.addSeries(LightweightCharts.LineSeries, {}, 2).setData(simpleData(30));
	return nextFrame();
}

function afterInitialInteractions() {
	return Promise.resolve();
}

async function afterFinalInteractions() {
	const panes = chart.panes();
	const initialHeights = panes.map(pane => pane.getHeight());
	const initialAxisTop = timeAxisTop();
	const initialRows = rowHeights().reduce((sum, h) => sum + h, 0);
	check(visibleSeparatorCount() === 2, `expected 2 separators, got ${visibleSeparatorCount()}`);

	// hide the middle pane: no height, one separator, the time axis does not move
	panes[1].setVisible(false);
	await nextFrame();
	check(!panes[1].visible(), 'pane 1 should report hidden');
	check(panes[1].getHeight() === 0, `hidden pane height should be 0, got ${panes[1].getHeight()}`);
	check(chart.paneSize(1).height === 0, `hidden paneSize height should be 0, got ${chart.paneSize(1).height}`);
	check(visibleSeparatorCount() === 1, `expected 1 separator, got ${visibleSeparatorCount()}`);
	check(timeAxisTop() === initialAxisTop, `time axis moved from ${initialAxisTop} to ${timeAxisTop()}`);
	check(rowHeights().reduce((sum, h) => sum + h, 0) === initialRows, 'visible rows must fill the same height');

	// a separator between visible panes still resizes them with a hidden pane in between
	panes[2].setHeight(80);
	await nextFrame();
	check(Math.abs(panes[2].getHeight() - 80) <= 1, `pane 2 should be 80px, got ${panes[2].getHeight()}`);
	panes[1].setHeight(80);
	await nextFrame();
	check(panes[1].getHeight() === 0, 'setHeight must not resize a hidden pane');

	// only the last pane shown: no separators, it takes the whole area
	panes[0].setVisible(false);
	await nextFrame();
	check(visibleSeparatorCount() === 0, `expected no separators, got ${visibleSeparatorCount()}`);
	check(timeAxisTop() === initialAxisTop, 'time axis moved with only the last pane shown');

	// screenshots skip hidden panes
	const shot = chart.takeScreenshot();
	check(shot.height === Math.round(chart.chartElement().getBoundingClientRect().height * window.devicePixelRatio), `screenshot height ${shot.height} should match the chart`);

	// showing every pane restores the stretch-based layout
	panes[0].setVisible(true);
	panes[1].setVisible(true);
	await nextFrame();
	check(visibleSeparatorCount() === 2, 'separators should return');
	check(timeAxisTop() === initialAxisTop, 'time axis moved after restore');
	check(panes[1].getHeight() > 0, 'pane 1 should have height again');
	check(Math.abs(panes[2].getHeight() - 80) <= 1, `pane 2 keeps its resized height, got ${panes[2].getHeight()}`);
	void initialHeights;
}
