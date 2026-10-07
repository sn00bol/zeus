const http = require('http');

const request = http.get('http://127.0.0.1:3000/health', response => {
    response.resume();
    if (response.statusCode !== 200) process.exitCode = 1;
});

request.setTimeout(3000, () => request.destroy(new Error('Healthcheck timed out')));
request.on('error', () => {
    process.exitCode = 1;
});