'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sign, uriEncode, S3 } = require('../lib/s3');

test('SigV4 matches the AWS documentation vector (GET with Range)', () => {
  const r = sign({
    method: 'GET', path: '/test.txt', query: {},
    headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', amzDate: '20130524T000000Z',
  });
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(r.signedHeaders, 'host;range;x-amz-content-sha256;x-amz-date');
});

test('uriEncode escapes like AWS', () => {
  assert.equal(uriEncode('a b/ü', true), 'a%20b/%C3%BC');
  assert.equal(uriEncode('a/b'), 'a%2Fb');
});

test('S3 put/list/get/del against a fake endpoint', async () => {
  const objects = new Map();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/ru-central1\/s3\/aws4_request/);
    const key = decodeURIComponent(u.pathname.replace(/^\/bkt\/?/, ''));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.end(); }
      else if (req.method === 'GET' && !key) {
        const items = [...objects.keys()].filter((k) => k.startsWith(u.searchParams.get('prefix') || ''))
          .map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('');
        res.end(`<ListBucketResult>${items}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      } else if (req.method === 'GET') { objects.has(key) ? res.end(objects.get(key)) : (res.statusCode = 404, res.end('<Error/>')); }
      else if (req.method === 'DELETE') { objects.delete(key); res.statusCode = 204; res.end(); }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const s3 = new S3({ endpoint: `http://127.0.0.1:${srv.address().port}`, bucket: 'bkt', accessKey: 'AK', secretKey: 'SK' });
    await s3.put('cs2/a b.tgz', Buffer.from('hello'));
    const list = await s3.list('cs2/');
    assert.deepEqual(list.map((x) => x.key), ['cs2/a b.tgz']);
    assert.equal((await s3.get('cs2/a b.tgz')).toString(), 'hello');
    await s3.del('cs2/a b.tgz');
    assert.equal((await s3.list('cs2/')).length, 0);
  } finally { srv.close(); }
});
