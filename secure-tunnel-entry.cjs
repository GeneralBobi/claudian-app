'use strict';
// The local memory server has no reason to receive the tunnel control-plane key.
delete process.env.CONTROL_PLANE_API_KEY;
delete process.env.OPENAI_API_KEY;
require('./mcp-server.cjs');
