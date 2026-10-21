const express = require('express');
const mongoose = require('mongoose');
const { errorHandler, notFound, responseEnvelope } = require('./middleware/response');

require('dotenv').config();

const app = express();

app.use(responseEnvelope);
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

require('./routes')(app);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI must be configured for the MongoDB Atlas database.');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    const port = process.env.PORT || 3000;
    return app.listen(port, () => {
        console.log(`Llama.io Care API listening on port ${port}`);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Unable to start the clinical API:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };
