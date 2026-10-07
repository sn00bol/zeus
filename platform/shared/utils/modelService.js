const { requestJson } = require('./agentBridge');

const PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp']);

async function fetchAvailableModels() {
    const { models } = await requestJson('/models');
    if (!Array.isArray(models)) {
        throw new Error('Bridge returned an invalid models list.');
    }
    return models;
}

async function getAvailableModels(database, scopeId) {
    const models = await fetchAvailableModels();
    const preference = await database.getModelPreference(scopeId);
    return { models, preference };
}

async function setPreferredModel(database, scopeId, provider, model) {
    const normalizedProvider = String(provider || '').toLowerCase();
    if (!PROVIDERS.has(normalizedProvider) || !model) {
        return { selected: null, reason: 'invalid-selection' };
    }

    const models = await fetchAvailableModels();
    const selected = models.find(item => item.provider === normalizedProvider && item.model === model);
    if (!selected) return { selected: null, reason: 'model-not-found' };

    await database.setModelPreference(scopeId, selected.provider, selected.model);
    return { selected };
}

async function setModelToAutomatic(database, scopeId) {
    await database.setModelPreference(scopeId, null, null);
}

module.exports = {
    getAvailableModels,
    setModelToAutomatic,
    setPreferredModel,
};
