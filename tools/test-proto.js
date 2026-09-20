#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-2.0-only
 * luci-proto-wwand — tests for the parts of the proto handler that are pure
 * decisions about data: which signal rows exist, and when the cell-lock button
 * may offer a value.
 *
 * WHY IT EVALUATES THE SHIPPED FILE. wwand.js is a LuCI module — `'require x'`
 * directives and a trailing `network.registerProtocol()` — so it cannot simply
 * be `require()`d. Copying the logic into the test would make the test agree
 * with itself and say nothing about what ships. Instead the real source is read,
 * its final export line (the only line that needs LuCI to exist) is swapped for
 * a return of the functions under test, and the result is evaluated against
 * stubs. Everything between those two points is the shipped code.
 *
 *   node tools/test-proto.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'htdocs/luci-static/resources/protocol/wwand.js');

/* luci.js gives every string a .format(); these tests only need %s and %d */
if (!String.prototype.format) {
	String.prototype.format = function () {
		let i = 0;
		const a = arguments;
		return this.replace(/%[sd]/g, function (m) {
			const v = a[i++];
			return (m === '%d') ? Number(v || 0) : String(v == null ? '' : v);
		});
	};
}

let checks = 0, failures = 0;
function eq(got, want, label) {
	checks++;
	const g = JSON.stringify(got), w = JSON.stringify(want);
	if (g !== w) { failures++; console.log(`FAIL: ${label}\n  got:  ${g}\n  want: ${w}`); }
}
function ok(v, label) { eq(!!v, true, label); }

/* --- the harness ---------------------------------------------------------- */

let capturedRows = [];

/* Build the module once per case with the rpc stubs this case needs. */
function withModule(rpc, fn) {
	capturedRows = [];

	let src = fs.readFileSync(SRC, 'utf8');
	const exportLine = "return network.registerProtocol('wwand', wwandProtocol);";
	if (src.indexOf(exportLine) < 0)
		throw new Error('the export line moved — this harness needs updating');
	src = src.replace(exportLine,
		'return { renderStatus: renderStatus, renderCellScan: renderCellScan };');

	const fmt = {
		/* VERBATIM from luci-app-wwand's format.js:398, which is the authority.
		   An approximation here would make the harness agree with itself rather
		   than with what ships: the real rule admits '' (it compares above
		   -32768) and rejects the -32768 sentinel, and a hand-rolled isNaN test
		   gets both of those backwards. Raised by review, 2026-09-20. */
		hasSignal: (v) => v != null && v > -32768,
		tbl: (rows) => { capturedRows = capturedRows.concat(rows); return { rows: rows }; },
		fmtOperator: () => null,
		regShort: () => 'registered',
		dBm: (v) => (v == null ? '—' : v + ' dBm'),
		dB: (v) => (v == null ? '—' : v + ' dB'),
		mhz: (v) => (v == null ? '—' : v + ' MHz'),
		fmtPlmn: () => '—',
	};

	const E = (tag, attr, children) => ({ tag: tag, attr: attr, children: children });
	const stub = new Proxy({}, { get: () => () => null });

	const fn2 = new Function(
		'L', 'E', '_', 'dom', 'ui', 'uci', 'form', 'network',
		'bands', 'modemopts', 'wrpc', 'fmt', 'modemsid', src);

	const mod = fn2(
		{ resolveDefault: (p, d) => Promise.resolve(p === undefined ? d : p),
		  Class: { extend: (o) => o } },
		E, (s) => s, stub, stub, stub, stub,
		new Proxy({ registerProtocol: (n, o) => o },
			{ get: (t, k) => (k in t) ? t[k] : (() => null) }),
		{ lteEarfcn: () => null, nrArfcn: () => ({ band: 'n78' }) },
		stub, rpc, fmt,
		{ modemSid: () => null, bindModem: () => null });

	return fn(mod);
}

function renderWith(sig, cells) {
	const modems = { m0: { model: 'RM520N', state: 'CONNECTED', registration: {} } };

	return withModule(
		{ status: () => modems, signal: () => sig, cells: () => ({ cells: cells || {} }) },
		(mod) => mod.renderStatus('wwan0', null, null, 'm0').then(() => capturedRows));
}

function labels(rows) { return rows.map((r) => r[0]); }
function valueOf(rows, label) {
	const r = rows.find((x) => x[0] === label);
	return r ? r[1] : null;
}


/* renderCellScan returns a DOM tree; flatten it to one string so an assertion
   can ask whether a value is offered ANYWHERE in it — as a <code>, as a button
   argument, or in the hint — rather than guessing at the shape. */
function flatten(node) {
	if (node == null) return '';
	if (typeof node == 'string' || typeof node == 'number') return String(node);
	if (Array.isArray(node)) return node.map(flatten).join(' ');
	if (typeof node == 'object')
		return [ flatten(node.children), JSON.stringify(node.attr || {}) ].join(' ');
	return '';
}

function lockText(cells) {
	return withModule({ status: () => ({ m0: { model: 'RM520N', state: 'CONNECTED',
			registration: {} } }),
		signal: () => ({}), cells: () => ({ cells: cells }) },
		(mod) => mod.renderCellScan('wwan0', () => null, null, 'm0')
			.then((tree) => flatten(tree) + ' ' + JSON.stringify(capturedRows)));
}

/* --- the tests ------------------------------------------------------------ */

(async function () {
	/* A ROW IS NOT GATED ON RSRP. The row used to appear only when rsrp was a
	   reading, so a source that reports SNR and RSSI and no RSRP — which the
	   AT paths do — had its whole line dropped rather than the missing field. */
	let rows = await renderWith({ lte: { snr: 0, rssi: -70 } }, {});
	ok(labels(rows).indexOf('LTE signal') >= 0,
		'lte row: rendered from snr and rssi alone, with no rsrp');
	eq(valueOf(rows, 'LTE signal'), 'SNR 0.0 dB · RSSI -70 dBm',
		'lte row: ...and a 0 dB SNR is a reading, not an absence');

	/* ...and a RAT that reported nothing must still not produce an empty row */
	rows = await renderWith({ lte: {} }, {});
	eq(labels(rows).indexOf('LTE signal'), -1,
		'lte row: an empty reading set produces no row at all');

	/* 5G RSRQ: the daemon reports it on the AT paths and the 5G cell table has
	   always rendered it — the summary line was the one place it was dropped */
	rows = await renderWith({ nr5g: { rsrp: -95, rsrq: -10, snr: 150 } }, {});
	eq(valueOf(rows, '5G signal'), 'RSRP -95 dBm · RSRQ -10 dB · SNR 15.0 dB',
		'5g row: rsrq is rendered beside rsrp and snr');

	/* the same gate as LTE, from the other side */
	rows = await renderWith({ nr5g: { rsrq: -10 } }, {});
	ok(labels(rows).indexOf('5G signal') >= 0,
		'5g row: rendered without rsrp too');

	/* THE LOCK STRING IS WITHHELD WHEN THE PCI IS NOT A READING. It is the
	   first field of `pci:arfcn:scs:band`, and it was the one field not
	   checked: `%d` of null renders 0, so the button offered a syntactically
	   valid lock naming cell 0 — which a modem accepts and then cannot find.
	   The flattened render is searched for the string itself, so this fails
	   whether the value reaches a <code> element, the button, or both. */
	let flat = await lockText({ nr5g_cell: { pci: null, bandwidth: 100000 },
		nr5g_arfcn: 431070 });
	eq(flat.indexOf('0:431070:30:78'), -1,
		'cell lock: a null PCI does not become cell 0');
	eq(flat.indexOf(':431070:'), -1,
		'cell lock: ...no lock value is offered at all');

	/* ...and a real PCI still produces one, so the guard is not simply off */
	flat = await lockText({ nr5g_cell: { pci: 242, bandwidth: 100000 },
		nr5g_arfcn: 431070 });
	ok(flat.indexOf('242:431070:30:78') >= 0,
		'cell lock: a real PCI is offered as pci:arfcn:scs:band');

	console.log(`test-proto: ${checks} checks, ${failures} failures`);
	process.exit(failures ? 1 : 0);
})();
