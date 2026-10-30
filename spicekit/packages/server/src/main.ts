/**
 * `spicekit-server` CLI entry: start the WebSocket host with environment
 * configuration and drain gracefully on SIGTERM/SIGINT (SPEC §7.1).
 */
import { main } from "./index.ts";

main();
