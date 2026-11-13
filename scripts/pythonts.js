const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const configuredPython = process.env.PYTHON_EXECUTABLE || process.env.PYTHON;
const virtualEnvironmentPython = process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
const python = configuredPython || (
    fs.existsSync(virtualEnvironmentPython)
        ? virtualEnvironmentPython
        : process.platform === 'win32' ? 'python' : 'python3'
);
const result = spawnSync(python, ['-m', 'pytest'], {
    cwd: projectRoot,
    stdio: 'inherit',
});

if (result.error) {
    console.error(`Could not run Python tests with "${python}": ${result.error.message}`);
    process.exitCode = 1;
} else {
    process.exitCode = result.status ?? 1;
}
