import { request, type IncomingMessage, type ServerResponse } from "node:http";

/** 转发的假代理：把 absolute-form 的请求原样发给目标，再把回答交回去。只给本机回环上的测试用。 */
export function passOn(incoming: IncomingMessage, response: ServerResponse): void {
  const forwarded = request(incoming.url ?? "", { method: incoming.method }, (reply) => {
    response.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(response);
  });
  forwarded.end();
}
