class HttpError extends Error {
    constructor(status, publicMessage, data = null) {
        super(publicMessage);
        this.status = status;
        this.publicMessage = publicMessage;
        this.data = data;
    }
}

module.exports = HttpError;
