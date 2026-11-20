import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import { applyAdminLoginPeer } from './admin-node-login-peer';

test('Node login identity always uses socket address, not spoofed headers', () => {
  const request = {
    method: 'POST', url: '/api/auth/login?source=browser',
    headers: {
      'cf-connecting-ip': '198.51.100.1',
      'x-forwarded-for': '198.51.100.2',
      'x-octafuse-peer-ip': '198.51.100.3',
    },
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as IncomingMessage;
  applyAdminLoginPeer(request);
  assert.equal(request.headers['x-octafuse-peer-ip'], '203.0.113.7');
  assert.equal(request.headers['cf-connecting-ip'], undefined);
  assert.equal(request.headers['x-forwarded-for'], undefined);
});

test('other admin routes retain their existing headers', () => {
  const request = {
    method: 'GET', url: '/api/auth/check',
    headers: { 'cf-connecting-ip': '198.51.100.1' },
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as IncomingMessage;
  applyAdminLoginPeer(request);
  assert.equal(request.headers['cf-connecting-ip'], '198.51.100.1');
  assert.equal(request.headers['x-octafuse-peer-ip'], undefined);
});
