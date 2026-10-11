const http = require('node:http');
const https = require('node:https');

function requestJson(path, { method = 'GET', body, timeoutMs = 10_000 } = {}) {
    const bridgeUrl = new URL(process.env.BRIDGE_URL || 'http://127.0.0.1:5000');
    const transport = bridgeUrl.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    const bridgeToken = String(process.env.BRIDGE_TOKEN || '').trim();
    if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
    }
    if (bridgeToken) headers.Authorization = `Bearer ${bridgeToken}`;

    return new Promise((resolve, reject) => {
        const request = transport.request(new URL(path, bridgeUrl), {
            method,
            headers,
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
                let data;
                try {
                    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch (error) {
                    reject(new Error(`Bridge returned invalid JSON: ${error.message}`));
                    return;
                }

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(data.error || `Bridge request failed (${response.statusCode}).`));
                    return;
                }
                resolve(data);
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Bridge request timed out after ${timeoutMs}ms.`));
        });
        request.on('error', reject);
        if (payload) request.write(payload);
        request.end();
    });
}

module.exports = { requestJson };
