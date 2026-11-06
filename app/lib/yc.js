'use strict';
// Yandex Cloud Compute API client. Authenticates with the IAM token of the service account
// attached to the VM this code runs on (metadata service), so no keys are stored anywhere.

const META_TOKEN_URL = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
const COMPUTE = 'https://compute.api.cloud.yandex.net/compute/v1';

class YandexCompute {
  constructor({ instanceId, fetchImpl = fetch, tokenUrl = META_TOKEN_URL, apiBase = COMPUTE, staticToken = null }) {
    this.instanceId = instanceId;
    this.fetch = fetchImpl;
    this.tokenUrl = tokenUrl;
    this.apiBase = apiBase;
    this.staticToken = staticToken;
    this.cached = null;
  }

  async token() {
    if (this.staticToken) return this.staticToken;
    if (this.cached && this.cached.exp > Date.now() + 60_000) return this.cached.value;
    const res = await this.fetch(this.tokenUrl, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
    const j = await res.json();
    this.cached = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return this.cached.value;
  }

  async call(method, path) {
    const res = await this.fetch(`${this.apiBase}${path}`, {
      method, headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok) {
      const e = new Error(`compute API ${method} ${path}: HTTP ${res.status} ${(json && json.message) || text.slice(0, 200)}`);
      e.status = res.status;
      throw e;
    }
    return json;
  }

  async describe() {
    const i = await this.call('GET', `/instances/${this.instanceId}`);
    const nic = (i.networkInterfaces && i.networkInterfaces[0]) || {};
    return {
      id: i.id,
      name: i.name,
      status: i.status, // PROVISIONING, RUNNING, STOPPING, STOPPED, STARTING, RESTARTING, UPDATING, ERROR, CRASHED, DELETING
      privateIp: nic.primaryV4Address && nic.primaryV4Address.address,
      publicIp: nic.primaryV4Address && nic.primaryV4Address.oneToOneNat && nic.primaryV4Address.oneToOneNat.address,
      platform: i.platformId,
      cores: i.resources && Number(i.resources.cores),
      memoryGb: i.resources && Math.round(Number(i.resources.memory) / 2 ** 30),
      createdAt: i.createdAt,
    };
  }

  start() { return this.call('POST', `/instances/${this.instanceId}:start`); }
  stop() { return this.call('POST', `/instances/${this.instanceId}:stop`); }
}

module.exports = { YandexCompute };
