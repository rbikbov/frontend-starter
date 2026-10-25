import { setupServer } from "msw/node";

// No default handlers: each test declares the network it needs through server.use().
export const server = setupServer();
