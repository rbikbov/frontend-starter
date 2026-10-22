import { setupServer } from "msw/node";

// Обработчики по умолчанию не заводятся: каждый тест объявляет сеть, которая ему нужна, через server.use().
export const server = setupServer();
