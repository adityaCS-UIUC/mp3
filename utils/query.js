const HttpError = require('./httpError');

function parseJsonParameter(value, name, fallback) {
    if (value === undefined) return fallback;
    try {
        if (typeof value !== 'string') throw new Error();
        const parsed = JSON.parse(value);
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
        return parsed;
    } catch {
        throw new HttpError(400, `The ${name} clinical query parameter must be valid JSON.`, null);
    }
}

function parseNonnegativeInteger(value, name, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new HttpError(400, `The ${name} clinical query parameter must be a nonnegative integer.`, null);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new HttpError(400, `The ${name} clinical query parameter must be a nonnegative integer.`, null);
    }
    return parsed;
}

function applyCollectionQuery(Model, parameters, defaultLimit) {
    const where = parseJsonParameter(parameters.where, 'where', {});
    const sort = parseJsonParameter(parameters.sort, 'sort', {});
    const select = parseJsonParameter(parameters.select, 'select', {});
    const skip = parseNonnegativeInteger(parameters.skip, 'skip', 0);
    const limit = parseNonnegativeInteger(parameters.limit, 'limit', defaultLimit);

    let query = Model.find(where).sort(sort).select(select).skip(skip);
    if (limit !== undefined) query = query.limit(limit);
    return { query, where };
}

async function executeCollectionQuery(Model, parameters, defaultLimit) {
    const { query, where } = applyCollectionQuery(Model, parameters, defaultLimit);
    if (parameters.count === 'true') {
        return Model.countDocuments(where);
    }
    return query;
}

function parseSelect(value) {
    return parseJsonParameter(value, 'select', {});
}

module.exports = { applyCollectionQuery, executeCollectionQuery, parseSelect };
