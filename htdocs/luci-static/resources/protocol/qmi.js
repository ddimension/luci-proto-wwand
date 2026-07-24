'use strict';
'require network';
'require protocol/wwand as wwand';

/* Back-compat alias. `qmi` is the historical proto name (the netifd shim still
   registers it via `add_protocol qmi`, so LuCI enumerates it from the ubus
   proto-handler list and loads this file for it). All behaviour lives in
   protocol/wwand.js, which registers BOTH `wwand` and the legacy `qmi` name
   from a single descriptor — requiring it here is what performs that
   registration. New interfaces are saved as `proto wwand`. */
return wwand;
