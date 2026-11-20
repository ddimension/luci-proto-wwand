# luci-proto-wwand

LuCI network-manager integration for the [wwand](../wwand) modem daemon.

It provides the JavaScript protocol handler for `proto 'wwand'` interfaces
(Network → Interfaces), using the current LuCI protocol API and talking to the
`wwand` ubus object directly for live data. It registers **only** `wwand`:
`proto qmi` stays with `luci-proto-qmi` and uqmi, and an existing interface is
handed over by migrating it, never by an alias.

## Features

- Inline configuration of all wwand-relevant options (APN, PDP type, PIN,
  auth, radio modes, manual PLMN, MTU, resilience, GPS) — written to
  `/etc/config/network`, translated by wwand's compat layer.
- **Live modem status** in the interface form (model/IMEI, registration,
  operator, LTE/5G signal, serving cell) polled from `wwand status`,
  `modem_signal`, `modem_cells`.
- **Cell-lock tab** with the current cell environment — serving cell and
  neighbour cells with technology, band, frequency, signal (RSRP/RSRQ/SNR/
  RSSI) and the ready-to-use `earfcn:pci` lock value — plus the `lock_4g`,
  `lock_5g`, `lock_persist` fields.
- Modem-device dropdown populated from `wwand status` (netdev + model/IMEI).
- **SIM card** field (`option iccid`): binds the connection to one card,
  picked from the cards wwand has seen (`sim_inventory`).

Band and frequency are derived client-side from EARFCN (LTE) / ARFCN (NR).
Bandwidth is shown when the daemon reports it (`bandwidth` field on a cell).

## Installation

Ships one protocol file, `…/resources/protocol/wwand.js`. It installs
**alongside** `luci-proto-qmi` — the two claim different protocol names and
different paths — so nothing has to be removed first. Depends on `luci-base`,
`wwand` and `luci-app-wwand`.

The ACL `root/usr/share/rpcd/acl.d/luci-proto-wwand.json` grants the LuCI
session read access to the `wwand` ubus object (`status`, `modem_signal`,
`modem_cells`, `modem_sim_slots`, `modem_probe`, `sim_inventory`) and to the
`/sys/class/gpio/` listing, plus write access to `modem_reset` and
`modem_sim_pin_verify`.
