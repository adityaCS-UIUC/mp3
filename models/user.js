const mongoose = require('mongoose');

const requiredText = {
    type: String,
    required: true,
    trim: true,
    validate: {
        validator: (value) => value.length > 0,
        message: 'A non-empty value is required.',
    },
};

const userSchema = new mongoose.Schema({
    name: requiredText,
    email: {
        ...requiredText,
        unique: true,
    },
    pendingTasks: {
        type: [String],
        default: [],
    },
    dateCreated: {
        type: Date,
        default: Date.now,
        immutable: true,
    },
});

module.exports = mongoose.model('User', userSchema);
