const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator: (value) => value.length > 0,
            message: 'A protocol name is required.',
        },
    },
    description: {
        type: String,
        default: '',
    },
    deadline: {
        type: Date,
        required: true,
    },
    completed: {
        type: Boolean,
        default: false,
    },
    assignedUser: {
        type: String,
        default: '',
    },
    assignedUserName: {
        type: String,
        default: 'unassigned',
    },
    dateCreated: {
        type: Date,
        default: Date.now,
        immutable: true,
    },
});

module.exports = mongoose.model('Task', taskSchema);
