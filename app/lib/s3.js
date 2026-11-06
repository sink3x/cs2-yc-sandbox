'use strict';
// Minimal S3 client (AWS Signature V4, path-style) for Yandex Object Storage. No dependencies.
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');

const sha256hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const EMPTY_SHA = sha256hex('');

function uriEncode(s, keepSlash) {
  let out = '';
  for (const ch of Buffer.from(String(s), 'utf8')) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += '%' + ch.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Pure signing function (exported for tests against AWS's published vectors). */
function sign({ method, path, query = {}, headers = {}, payloadHash, accessKey, secretKey, region, service = 's3', amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  h['x-amz-date'] = amzDate;
  h['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((n) => `${n}:${h[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signature, signedHeaders, canonicalRequest, headers: h };
}

function amzNow(d = new Date()) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

class S3 {
  constructor({ endpoint = 'https://storage.yandexcloud.net', region = 'ru-central1', bucket, accessKey, secretKey }) {
    this.url = new URL(endpoint);
    this.region = region;
    this.bucket = bucket;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
  }

  request(method, key, { query = {}, body = null } = {}) {
    const pathname = `/${this.bucket}${key ? '/' + uriEncode(key, true) : ''}`;
    const payload = body ? Buffer.from(body) : Buffer.alloc(0);
    const payloadHash = payload.length ? sha256hex(payload) : EMPTY_SHA;
    const signed = sign({
      method, path: pathname, query, headers: { host: this.url.host },
      payloadHash, accessKey: this.accessKey, secretKey: this.secretKey, region: this.region, amzDate: amzNow(),
    });
    const qs = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');
    const lib = this.url.protocol === 'http:' ? http : https;
    const headers = { ...signed.headers, authorization: signed.authorization, 'content-length': payload.length };
    return new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: this.url.hostname, port: this.url.port || undefined, method,
        path: pathname + (qs ? `?${qs}` : ''), headers, timeout: 60000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(buf);
          const e = new Error(`s3 ${method} ${key || '/'} -> ${res.statusCode}: ${buf.toString('utf8').slice(0, 300)}`);
          e.status = res.statusCode;
          reject(e);
        });
      });
      req.on('timeout', () => req.destroy(new Error('s3: timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  put(key, body) { return this.request('PUT', key, { body }); }
  get(key) { return this.request('GET', key); }
  del(key) { return this.request('DELETE', key); }

  async list(prefix = '') {
    const out = [];
    let token;
    do {
      const query = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const xml = (await this.request('GET', '', { query })).toString('utf8');
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const g = (tag) => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(m[1]) || [])[1];
        out.push({ key: decodeXml(g('Key')), size: Number(g('Size')), lastModified: g('LastModified') });
      }
      const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? decodeXml(next[1]) : null;
    } while (token);
    return out;
  }
}

function decodeXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

module.exports = { S3, sign, amzNow, sha256hex, uriEncode, decodeXml };
