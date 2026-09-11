const DEFAULT_WEB_PORT = "3110";

export const webPort = process.env.SHELF_JUDGE_E2E_WEB_PORT ?? DEFAULT_WEB_PORT;
export const webUrl = `http://127.0.0.1:${webPort}`;
