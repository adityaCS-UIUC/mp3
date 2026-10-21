function responseEnvelope(req, res, next) {
    res.clinical = (status, message, data = null) => {
        return res.status(status).json({ message, data });
    };
    next();
}

function notFound(req, res) {
    return res.clinical(404, 'The requested clinical resource was not found.', null);
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.clinical(400, 'The clinical request body must contain valid JSON.', null);
    }

    if (error.status && error.status >= 400 && error.status < 500) {
        return res.clinical(
            error.status,
            error.publicMessage || 'The clinical request could not be processed.',
            error.data ?? null,
        );
    }

    if (error.name === 'ValidationError' || error.name === 'CastError' || error.code === 11000) {
        const message = error.code === 11000
            ? 'A clinician with this email is already registered.'
            : 'The clinical record contains missing or invalid fields.';
        return res.clinical(400, message, null);
    }

    console.error('Internal clinical API error:', error);
    return res.clinical(500, 'The clinical record service encountered an internal error.', null);
}

module.exports = { errorHandler, notFound, responseEnvelope };
