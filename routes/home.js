const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
    return res.clinical(200, 'Llama.io Care clinical ward API is operational.', {
        service: 'llama-io-care',
    });
});

module.exports = router;
