import { connection } from "next/server";

// Проверка живости для платформы деплоя и мониторинга. connection() исключает обработчик из
// пререндера: без него ответ собирается один раз при сборке и ничего не говорит о живом сервере.
export async function GET() {
  await connection();
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
