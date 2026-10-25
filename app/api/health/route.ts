import { connection } from "next/server";

// Liveness check for the deployment platform and monitoring. connection() excludes the handler from
// prerendering: without it the response is built once at build time and says nothing about the live server.
export async function GET() {
  await connection();
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
