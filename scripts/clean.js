const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const cacheDirectoryNames = new Set([
    '.cache',
    '.hypothesis',
    '.mypy_cache',
    '.nox',
    '.pytest_cache',
    '.ruff_cache',
    '.tox',
    '__pycache__',
]);
const skippedDirectoryNames = new Set([
    '.git',
    '.venv',
    'build',
    'database',
    'dist',
    'env',
    'node_modules',
    'venv',
]);

function assertInsideProject(targetPath) {
    const relativePath = path.relative(projectRoot, targetPath);
    if (
        !relativePath
        || relativePath === '..'
        || relativePath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativePath)
    ) {
        throw new Error(`Refusing to clean a path outside the project: ${targetPath}`);
    }
}

function cleanDirectory(directory, dryRun, cleanedPaths) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const targetPath = path.join(directory, entry.name);
        assertInsideProject(targetPath);

        if (entry.isDirectory()) {
            if (skippedDirectoryNames.has(entry.name)) continue;
            if (cacheDirectoryNames.has(entry.name)) {
                cleanedPaths.push(targetPath);
                if (!dryRun) fs.rmSync(targetPath, { recursive: true, force: true });
                continue;
            }
            cleanDirectory(targetPath, dryRun, cleanedPaths);
        } else if (entry.isFile() && /\.py[co]$/i.test(entry.name)) {
            cleanedPaths.push(targetPath);
            if (!dryRun) fs.rmSync(targetPath, { force: true });
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.some(argument => argument !== '--dry-run') || args.length > 1) {
        console.error('Usage: node scripts/clean-cache.js [--dry-run]');
        process.exitCode = 2;
        return;
    }

    const dryRun = args.includes('--dry-run');
    const cleanedPaths = [];
    cleanDirectory(projectRoot, dryRun, cleanedPaths);

    if (!cleanedPaths.length) {
        console.log('No project cache files found.');
        return;
    }

    for (const targetPath of cleanedPaths) {
        const relativePath = path.relative(projectRoot, targetPath);
        console.log(`${dryRun ? 'Would remove' : 'Removed'} ${relativePath}`);
    }
    console.log(`${dryRun ? 'Found' : 'Removed'} ${cleanedPaths.length} cache item(s).`);
}

main();
