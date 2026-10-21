const mongoose = require('mongoose');
const HttpError = require('./httpError');

function badRequest(message) {
    throw new HttpError(400, message, null);
}

function validateUserInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest('The clinician record must be a JSON object.');
    }
    if (typeof body.name !== 'string' || !body.name.trim()) {
        badRequest('A clinician name is required.');
    }
    if (typeof body.email !== 'string' || !body.email.trim()) {
        badRequest('A clinician email is required.');
    }
    if (body.pendingTasks !== undefined &&
        (!Array.isArray(body.pendingTasks) || body.pendingTasks.some((id) => typeof id !== 'string'))) {
        badRequest('Pending clinical tasks must be supplied as an array of task IDs.');
    }

    const pendingTasks = [...new Set(body.pendingTasks || [])];
    if (pendingTasks.some((id) => !mongoose.isObjectIdOrHexString(id))) {
        badRequest('Every pending clinical task must have a valid task ID.');
    }

    return {
        name: body.name.trim(),
        email: body.email.trim(),
        pendingTasks,
    };
}

function validateTaskInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest('The clinical task record must be a JSON object.');
    }
    if (typeof body.name !== 'string' || !body.name.trim()) {
        badRequest('A clinical protocol name is required.');
    }
    const deadlineHasValidType = typeof body.deadline === 'string' ||
        typeof body.deadline === 'number' || body.deadline instanceof Date;
    if (!deadlineHasValidType || body.deadline === '' ||
        Number.isNaN(new Date(body.deadline).getTime())) {
        badRequest('A valid clinical task deadline is required.');
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
        badRequest('Clinical task notes must be text.');
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
        badRequest('Clinical task completion status must be a boolean.');
    }
    if (body.assignedUser !== undefined && typeof body.assignedUser !== 'string') {
        badRequest('The assigned clinician must be identified by a valid user ID.');
    }
    if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
        badRequest('The assigned clinician name must be text.');
    }

    const assignedUser = body.assignedUser || '';
    if (assignedUser && !mongoose.isObjectIdOrHexString(assignedUser)) {
        badRequest('The assigned clinician must have a valid user ID.');
    }
    if (!assignedUser && body.assignedUserName !== undefined && body.assignedUserName !== 'unassigned') {
        badRequest('An unassigned clinical task must use the clinician name "unassigned".');
    }

    return {
        name: body.name.trim(),
        description: body.description ?? '',
        deadline: new Date(body.deadline),
        completed: body.completed ?? false,
        assignedUser,
        assignedUserName: body.assignedUserName,
    };
}

module.exports = { validateTaskInput, validateUserInput };
