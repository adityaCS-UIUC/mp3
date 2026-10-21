const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const HttpError = require('../utils/httpError');
const { executeCollectionQuery, parseSelect } = require('../utils/query');
const { validateUserInput } = require('../utils/validation');

const router = express.Router();

async function getUserOr404(id) {
    if (!mongoose.isObjectIdOrHexString(id)) {
        throw new HttpError(404, 'The requested clinician record was not found.', null);
    }
    const user = await User.findById(id);
    if (!user) throw new HttpError(404, 'The requested clinician record was not found.', null);
    return user;
}

async function validatePendingTasks(ids) {
    if (!ids.length) return [];
    const tasks = await Task.find({ _id: { $in: ids } });
    if (tasks.length !== ids.length) {
        throw new HttpError(404, 'One or more pending clinical tasks were not found.', null);
    }
    if (tasks.some((task) => task.completed)) {
        throw new HttpError(400, 'Completed clinical tasks cannot be placed in a pending queue.', null);
    }
    return tasks;
}

async function ensureUniqueEmail(email, excludedId) {
    const filter = { email };
    if (excludedId) filter._id = { $ne: excludedId };
    if (await User.exists(filter)) {
        throw new HttpError(400, 'A clinician with this email is already registered.', null);
    }
}

async function moveTasksToUser(user, tasks) {
    const taskIds = tasks.map((task) => task._id.toString());
    const priorUserIds = tasks
        .map((task) => task.assignedUser)
        .filter((id) => id && id !== user._id.toString());

    if (priorUserIds.length) {
        await User.updateMany(
            { _id: { $in: priorUserIds } },
            { $pull: { pendingTasks: { $in: taskIds } } },
        );
    }
    if (taskIds.length) {
        await Task.updateMany(
            { _id: { $in: taskIds } },
            { $set: { assignedUser: user._id.toString(), assignedUserName: user.name } },
        );
    }
}

router.get('/', async (req, res) => {
    const data = await executeCollectionQuery(User, req.query, undefined);
    return res.clinical(200, 'Clinician records retrieved successfully.', data);
});

router.post('/', async (req, res) => {
    const input = validateUserInput(req.body);
    await ensureUniqueEmail(input.email);
    const tasks = await validatePendingTasks(input.pendingTasks);

    const user = new User(input);
    await user.validate();
    await user.save();
    await moveTasksToUser(user, tasks);
    return res.clinical(201, 'Clinician record created successfully.', user);
});

router.get('/:id', async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
        throw new HttpError(404, 'The requested clinician record was not found.', null);
    }
    const user = await User.findById(req.params.id).select(parseSelect(req.query.select));
    if (!user) throw new HttpError(404, 'The requested clinician record was not found.', null);
    return res.clinical(200, 'Clinician record retrieved successfully.', user);
});

router.put('/:id', async (req, res) => {
    const user = await getUserOr404(req.params.id);
    const input = validateUserInput(req.body);
    await ensureUniqueEmail(input.email, user._id);
    const tasks = await validatePendingTasks(input.pendingTasks);
    const oldPendingTasks = user.pendingTasks;

    user.name = input.name;
    user.email = input.email;
    user.pendingTasks = input.pendingTasks;
    await user.validate();

    const removedTaskIds = oldPendingTasks.filter((id) => !input.pendingTasks.includes(id));
    if (removedTaskIds.length) {
        await Task.updateMany(
            { _id: { $in: removedTaskIds }, assignedUser: user._id.toString() },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
        );
    }
    await moveTasksToUser(user, tasks);
    await Task.updateMany(
        { assignedUser: user._id.toString() },
        { $set: { assignedUserName: user.name } },
    );
    await user.save();
    return res.clinical(200, 'Clinician record updated successfully.', user);
});

router.delete('/:id', async (req, res) => {
    const user = await getUserOr404(req.params.id);
    await Task.updateMany(
        { assignedUser: user._id.toString() },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
    );
    await user.deleteOne();
    return res.status(204).end();
});

module.exports = router;
