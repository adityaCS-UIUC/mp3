const express = require('express');
const mongoose = require('mongoose');
const Task = require('../models/task');
const User = require('../models/user');
const HttpError = require('../utils/httpError');
const { executeCollectionQuery, parseSelect } = require('../utils/query');
const { validateTaskInput } = require('../utils/validation');

const router = express.Router();

async function getTaskOr404(id) {
    if (!mongoose.isObjectIdOrHexString(id)) {
        throw new HttpError(404, 'The requested clinical task was not found.', null);
    }
    const task = await Task.findById(id);
    if (!task) throw new HttpError(404, 'The requested clinical task was not found.', null);
    return task;
}

async function resolveAssignee(input) {
    if (!input.assignedUser) {
        input.assignedUserName = 'unassigned';
        return null;
    }
    const user = await User.findById(input.assignedUser);
    if (!user) throw new HttpError(404, 'The assigned clinician record was not found.', null);
    if (input.assignedUserName !== undefined && input.assignedUserName !== user.name) {
        throw new HttpError(400, 'The assigned clinician name does not match the clinician record.', null);
    }
    input.assignedUserName = user.name;
    return user;
}

async function synchronizePendingTask(task, previousUserId) {
    const taskId = task._id.toString();
    if (previousUserId && previousUserId !== task.assignedUser) {
        await User.updateOne({ _id: previousUserId }, { $pull: { pendingTasks: taskId } });
    }
    if (task.assignedUser) {
        const operation = task.completed
            ? { $pull: { pendingTasks: taskId } }
            : { $addToSet: { pendingTasks: taskId } };
        await User.updateOne({ _id: task.assignedUser }, operation);
    }
}

router.get('/', async (req, res) => {
    const data = await executeCollectionQuery(Task, req.query, 100);
    return res.clinical(200, 'Clinical care tasks retrieved successfully.', data);
});

router.post('/', async (req, res) => {
    const input = validateTaskInput(req.body);
    await resolveAssignee(input);
    const task = new Task(input);
    await task.validate();
    await task.save();
    await synchronizePendingTask(task, '');
    return res.clinical(201, 'Clinical care task created successfully.', task);
});

router.get('/:id', async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
        throw new HttpError(404, 'The requested clinical task was not found.', null);
    }
    const task = await Task.findById(req.params.id).select(parseSelect(req.query.select));
    if (!task) throw new HttpError(404, 'The requested clinical task was not found.', null);
    return res.clinical(200, 'Clinical care task retrieved successfully.', task);
});

router.put('/:id', async (req, res) => {
    const task = await getTaskOr404(req.params.id);
    const input = validateTaskInput(req.body);
    await resolveAssignee(input);
    const previousUserId = task.assignedUser;

    task.name = input.name;
    task.description = input.description;
    task.deadline = input.deadline;
    task.completed = input.completed;
    task.assignedUser = input.assignedUser;
    task.assignedUserName = input.assignedUserName;
    await task.validate();
    await task.save();
    await synchronizePendingTask(task, previousUserId);
    return res.clinical(200, 'Clinical care task updated successfully.', task);
});

router.delete('/:id', async (req, res) => {
    const task = await getTaskOr404(req.params.id);
    if (task.assignedUser) {
        await User.updateOne(
            { _id: task.assignedUser },
            { $pull: { pendingTasks: task._id.toString() } },
        );
    }
    await task.deleteOne();
    return res.status(204).end();
});

module.exports = router;
