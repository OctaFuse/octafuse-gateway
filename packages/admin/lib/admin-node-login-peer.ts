import type { IncomingMessage } from 'node:http';

/** Only the login route needs a trusted socket identity. */
export function applyAdminLoginPeer(request: IncomingMessage): void {
  if (request.method !== 'POST' || request.url?.split('?', 1)[0] !== '/api/auth/login') return;
  delete request.headers['cf-connecting-ip'];
  delete request.headers['x-forwarded-for'];
  request.headers['x-octafuse-peer-ip'] = request.socket.remoteAddress ?? '';
}
