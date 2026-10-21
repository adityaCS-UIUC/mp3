const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const User = require('../models/user');
const Task = require('../models/task');
const { notFound, responseEnvelope } = require('../middleware/response');
const { applyCollectionQuery, executeCollectionQuery } = require('../utils/query');
const { validateTaskInput, validateUserInput } = require('../utils/validation');
const userRouter = require('../routes/users');
const taskRouter = require('../routes/tasks');

function queryDouble() {
    const calls = [];
    const query = {
        sort(value) {
            calls.push(['sort', value]);
            return this;
        },
        select(value) {
            calls.push(['select', value]);
            return this;
        },
        skip(value) {
            calls.push(['skip', value]);
            return this;
        },
        limit(value) {
            calls.push(['limit', value]);
            return this;
        },
    };
    const Model = {
        find(value) {
            calls.push(['find', value]);
            return query;
        },
        countDocuments(value) {
            calls.push(['countDocuments', value]);
            return Promise.resolve(0);
        },
    };
    return { calls, Model, query };
}

function routeHandler(router, method, path) {
    const layer = router.stack.find((entry) => entry.route.path === path && entry.route.methods[method]);
    return layer.route.stack[0].handle;
}

function responseDouble() {
    const result = {};
    return {
        result,
        response: {
            clinical(status, message, data) {
                Object.assign(result, { status, message, data });
                return this;
            },
        },
    };
}

describe('Llama.io Care API foundation', () => {
    it('wraps responses in exactly message and data', () => {
        let statusCode;
        let body;
        const response = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(value) {
                body = value;
                return this;
            },
        };

        responseEnvelope({}, response, () => {});
        response.clinical(200, 'Clinical operation completed.', { id: '123' });
        assert.equal(statusCode, 200);
        assert.deepEqual(Object.keys(body), ['message', 'data']);

        notFound({}, response);
        assert.equal(statusCode, 404);
        assert.deepEqual(Object.keys(body), ['message', 'data']);
    });

    it('requires clinician names and unique emails at the schema level', async () => {
        await assert.rejects(new User({ email: 'nurse@example.org' }).validate());
        assert.equal(User.schema.path('email').options.unique, true);
    });

    it('requires clinical task names and deadlines and supplies defaults', async () => {
        await assert.rejects(new Task({ name: 'Medication round' }).validate());
        const task = new Task({ name: 'Medication round', deadline: new Date() });
        await task.validate();
        assert.equal(task.description, '');
        assert.equal(task.completed, false);
        assert.equal(task.assignedUser, '');
        assert.equal(task.assignedUserName, 'unassigned');
        assert.ok(task.dateCreated instanceof Date);
    });

    it('rejects missing and incorrectly typed creation fields', () => {
        for (const invalidUser of [
            {},
            { name: 42, email: 'nurse@example.org' },
            { name: 'Nurse', email: false },
        ]) {
            assert.throws(() => validateUserInput(invalidUser), (error) => error.status === 400);
        }
        for (const invalidTask of [
            {},
            { name: 42, deadline: '2026-11-01' },
            { name: 'Medication round', deadline: false },
            { name: 'Medication round', deadline: {} },
            { name: 'Medication round', deadline: 'not-a-date' },
        ]) {
            assert.throws(() => validateTaskInput(invalidTask), (error) => error.status === 400);
        }
    });

    it('returns 404 for malformed IDs without querying MongoDB', async () => {
        for (const [router, label] of [[userRouter, 'clinician'], [taskRouter, 'task']]) {
            for (const method of ['get', 'put']) {
                const handler = routeHandler(router, method, '/:id');
                await assert.rejects(
                    handler({ params: { id: 'invalid' }, query: {}, body: {} }, responseDouble().response),
                    (error) => error.status === 404 && error.message.includes(label),
                );
            }
        }
    });

    it('applies select on single resources while ignoring other query parameters', async () => {
        const id = '507f1f77bcf86cd799439011';
        const cases = [
            { Model: User, router: userRouter, document: { _id: id, name: 'Nurse Rivera' } },
            { Model: Task, router: taskRouter, document: { _id: id, name: 'Vitals check' } },
        ];

        for (const testCase of cases) {
            const originalFindById = testCase.Model.findById;
            let selected;
            testCase.Model.findById = () => ({
                select: async (value) => {
                    selected = value;
                    return testCase.document;
                },
            });
            try {
                const { response, result } = responseDouble();
                await routeHandler(testCase.router, 'get', '/:id')({
                    params: { id },
                    query: {
                        select: '{"name":1}',
                        where: '{"completed":true}',
                        limit: '1',
                    },
                }, response);
                assert.equal(result.status, 200);
                assert.equal(result.data, testCase.document);
                assert.deepEqual(selected, { name: 1 });
            } finally {
                testCase.Model.findById = originalFindById;
            }
        }
    });

    it('returns 400 when a clinician email is already registered', async () => {
        const originalExists = User.exists;
        User.exists = async () => ({ _id: 'existing-user' });
        try {
            await assert.rejects(
                routeHandler(userRouter, 'post', '/')({
                    body: { name: 'Nurse Rivera', email: 'rivera@example.org' },
                }, responseDouble().response),
                (error) => error.status === 400,
            );
        } finally {
            User.exists = originalExists;
        }
    });

    it('creates valid users and tasks with HTTP 201 responses', async () => {
        const originalExists = User.exists;
        const originalUserSave = User.prototype.save;
        const originalTaskSave = Task.prototype.save;
        User.exists = async () => null;
        User.prototype.save = async function save() { return this; };
        Task.prototype.save = async function save() { return this; };
        try {
            const userResponse = responseDouble();
            await routeHandler(userRouter, 'post', '/')({
                body: { name: 'Nurse Rivera', email: 'rivera@example.org' },
            }, userResponse.response);
            assert.equal(userResponse.result.status, 201);
            assert.equal(userResponse.result.data.name, 'Nurse Rivera');

            const taskResponse = responseDouble();
            await routeHandler(taskRouter, 'post', '/')({
                body: { name: 'Vitals check', deadline: '2026-11-01T12:00:00.000Z' },
            }, taskResponse.response);
            assert.equal(taskResponse.result.status, 201);
            assert.equal(taskResponse.result.data.name, 'Vitals check');
        } finally {
            User.exists = originalExists;
            User.prototype.save = originalUserSave;
            Task.prototype.save = originalTaskSave;
        }
    });

    it('removes a deleted task from its assigned clinician queue', async () => {
        const id = '507f1f77bcf86cd799439011';
        const userId = '507f191e810c19729de860ea';
        const originalFindById = Task.findById;
        const originalUpdateOne = User.updateOne;
        let userUpdate;
        let deleted = false;
        Task.findById = async () => ({
            _id: { toString: () => id },
            assignedUser: userId,
            async deleteOne() { deleted = true; },
        });
        User.updateOne = async (...arguments_) => { userUpdate = arguments_; };
        try {
            const { response, result } = responseDouble();
            await routeHandler(taskRouter, 'delete', '/:id')({ params: { id } }, response);
            assert.equal(result.status, 200);
            assert.deepEqual(userUpdate, [
                { _id: userId },
                { $pull: { pendingTasks: id } },
            ]);
            assert.equal(deleted, true);
        } finally {
            Task.findById = originalFindById;
            User.updateOne = originalUpdateOne;
        }
    });

    it('unassigns every task owned by a deleted clinician', async () => {
        const id = '507f1f77bcf86cd799439011';
        const originalFindById = User.findById;
        const originalUpdateMany = Task.updateMany;
        let taskUpdate;
        let deleted = false;
        User.findById = async () => ({
            _id: { toString: () => id },
            async deleteOne() { deleted = true; },
        });
        Task.updateMany = async (...arguments_) => { taskUpdate = arguments_; };
        try {
            const { response, result } = responseDouble();
            await routeHandler(userRouter, 'delete', '/:id')({ params: { id } }, response);
            assert.equal(result.status, 200);
            assert.deepEqual(taskUpdate, [
                { assignedUser: id },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
            ]);
            assert.equal(deleted, true);
        } finally {
            User.findById = originalFindById;
            Task.updateMany = originalUpdateMany;
        }
    });

    it('replaces a clinician and synchronizes removed, retained, and moved tasks', async () => {
        const userId = '507f1f77bcf86cd799439011';
        const otherUserId = '507f191e810c19729de860ea';
        const removedId = '507f1f77bcf86cd799439012';
        const retainedId = '507f1f77bcf86cd799439013';
        const addedId = '507f1f77bcf86cd799439014';
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({
            _id: userId,
            name: 'Nurse Oldname',
            email: 'old@example.org',
            pendingTasks: [removedId, retainedId],
            dateCreated: createdAt,
        });
        user.save = async function save() { return this; };

        const originals = {
            findUser: User.findById,
            exists: User.exists,
            updateUsers: User.updateMany,
            findTasks: Task.find,
            updateTasks: Task.updateMany,
        };
        const userUpdates = [];
        const taskUpdates = [];
        User.findById = async () => user;
        User.exists = async () => null;
        User.updateMany = async (...arguments_) => { userUpdates.push(arguments_); };
        Task.find = async () => [
            { _id: { toString: () => retainedId }, completed: false, assignedUser: userId },
            { _id: { toString: () => addedId }, completed: false, assignedUser: otherUserId },
        ];
        Task.updateMany = async (...arguments_) => { taskUpdates.push(arguments_); };
        try {
            const { response, result } = responseDouble();
            await routeHandler(userRouter, 'put', '/:id')({
                params: { id: userId },
                body: {
                    name: 'Nurse Newname',
                    email: 'new@example.org',
                    pendingTasks: [retainedId, addedId],
                },
            }, response);

            assert.equal(result.status, 200);
            assert.deepEqual(user.pendingTasks.toObject(), [retainedId, addedId]);
            assert.equal(user.dateCreated.getTime(), createdAt.getTime());
            assert.deepEqual(userUpdates, [[
                { _id: { $in: [otherUserId] } },
                { $pull: { pendingTasks: { $in: [retainedId, addedId] } } },
            ]]);
            assert.deepEqual(taskUpdates, [
                [
                    { _id: { $in: [removedId] }, assignedUser: userId },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
                ],
                [
                    { _id: { $in: [retainedId, addedId] } },
                    { $set: { assignedUser: userId, assignedUserName: 'Nurse Newname' } },
                ],
                [
                    { assignedUser: userId },
                    { $set: { assignedUserName: 'Nurse Newname' } },
                ],
            ]);
        } finally {
            User.findById = originals.findUser;
            User.exists = originals.exists;
            User.updateMany = originals.updateUsers;
            Task.find = originals.findTasks;
            Task.updateMany = originals.updateTasks;
        }
    });

    it('performs no writes when user PUT reference validation fails', async () => {
        const userId = '507f1f77bcf86cd799439011';
        const completedId = '507f1f77bcf86cd799439012';
        const user = new User({ name: 'Nurse Rivera', email: 'rivera@example.org' });
        let writes = 0;
        const originals = {
            findUser: User.findById,
            exists: User.exists,
            updateUsers: User.updateMany,
            findTasks: Task.find,
            updateTasks: Task.updateMany,
        };
        User.findById = async () => user;
        User.exists = async () => null;
        User.updateMany = async () => { writes += 1; };
        Task.find = async () => [{ _id: completedId, completed: true }];
        Task.updateMany = async () => { writes += 1; };
        user.save = async () => { writes += 1; };
        try {
            await assert.rejects(
                routeHandler(userRouter, 'put', '/:id')({
                    params: { id: userId },
                    body: {
                        name: 'Nurse Rivera',
                        email: 'rivera@example.org',
                        pendingTasks: [completedId],
                    },
                }, responseDouble().response),
                (error) => error.status === 400,
            );
            assert.equal(writes, 0);
        } finally {
            User.findById = originals.findUser;
            User.exists = originals.exists;
            User.updateMany = originals.updateUsers;
            Task.find = originals.findTasks;
            Task.updateMany = originals.updateTasks;
        }
    });

    it('synchronizes task moves, completion, reopening, and unassignment', async () => {
        const taskId = '507f1f77bcf86cd799439011';
        const firstUserId = '507f191e810c19729de860ea';
        const secondUserId = '507f191e810c19729de860eb';
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const originalTaskFind = Task.findById;
        const originalUserFind = User.findById;
        const originalUserUpdate = User.updateOne;

        async function performUpdate(previous, body) {
            const task = new Task({
                _id: taskId,
                name: 'Vitals check',
                deadline: '2026-11-01T12:00:00.000Z',
                dateCreated: createdAt,
                ...previous,
            });
            task.save = async function save() { return this; };
            const updates = [];
            Task.findById = async () => task;
            User.findById = async (id) => ({ _id: id, name: 'Nurse Target' });
            User.updateOne = async (...arguments_) => { updates.push(arguments_); };
            const result = responseDouble();
            await routeHandler(taskRouter, 'put', '/:id')({ params: { id: taskId }, body }, result.response);
            assert.equal(result.result.status, 200);
            assert.equal(task.dateCreated.getTime(), createdAt.getTime());
            return { task, updates };
        }

        try {
            const moved = await performUpdate(
                { assignedUser: firstUserId, assignedUserName: 'Nurse First' },
                { name: 'Vitals check', deadline: '2026-11-02', assignedUser: secondUserId },
            );
            assert.deepEqual(moved.updates, [
                [{ _id: firstUserId }, { $pull: { pendingTasks: taskId } }],
                [{ _id: secondUserId }, { $addToSet: { pendingTasks: taskId } }],
            ]);
            assert.equal(moved.task.assignedUserName, 'Nurse Target');

            const completed = await performUpdate(
                { assignedUser: secondUserId, assignedUserName: 'Nurse Target' },
                { name: 'Vitals check', deadline: '2026-11-02', completed: true, assignedUser: secondUserId },
            );
            assert.deepEqual(completed.updates, [
                [{ _id: secondUserId }, { $pull: { pendingTasks: taskId } }],
            ]);

            const reopened = await performUpdate(
                { completed: true, assignedUser: secondUserId, assignedUserName: 'Nurse Target' },
                { name: 'Vitals check', deadline: '2026-11-02', completed: false, assignedUser: secondUserId },
            );
            assert.deepEqual(reopened.updates, [
                [{ _id: secondUserId }, { $addToSet: { pendingTasks: taskId } }],
            ]);

            const unassigned = await performUpdate(
                { assignedUser: secondUserId, assignedUserName: 'Nurse Target' },
                { name: 'Vitals check', deadline: '2026-11-02', assignedUser: '' },
            );
            assert.deepEqual(unassigned.updates, [
                [{ _id: secondUserId }, { $pull: { pendingTasks: taskId } }],
            ]);
            assert.equal(unassigned.task.assignedUserName, 'unassigned');
        } finally {
            Task.findById = originalTaskFind;
            User.findById = originalUserFind;
            User.updateOne = originalUserUpdate;
        }
    });

    it('chains combined collection parameters through Mongoose', () => {
        const { calls, Model, query } = queryDouble();
        const result = applyCollectionQuery(Model, {
            where: '{"completed":false}',
            sort: '{"deadline":1}',
            select: '{"name":1,"deadline":1}',
            skip: '20',
            limit: '10',
        }, 100);

        assert.equal(result.query, query);
        assert.deepEqual(result.where, { completed: false });
        assert.deepEqual(calls, [
            ['find', { completed: false }],
            ['sort', { deadline: 1 }],
            ['select', { name: 1, deadline: 1 }],
            ['skip', 20],
            ['limit', 10],
        ]);
    });

    it('defaults tasks to 100 results and leaves users unlimited', () => {
        const tasks = queryDouble();
        applyCollectionQuery(tasks.Model, {}, 100);
        assert.deepEqual(tasks.calls.at(-1), ['limit', 100]);

        const users = queryDouble();
        applyCollectionQuery(users.Model, {}, undefined);
        assert.equal(users.calls.some(([method]) => method === 'limit'), false);
    });

    it('uses countDocuments and returns zero when count mode has no matches', async () => {
        const { calls, Model } = queryDouble();
        const result = await executeCollectionQuery(Model, {
            where: '{"completed":true}',
            count: 'true',
        }, 100);

        assert.equal(result, 0);
        assert.deepEqual(calls.at(-1), ['countDocuments', { completed: true }]);
    });

    it('rejects malformed JSON and invalid pagination values with HTTP 400 errors', () => {
        for (const parameters of [
            { where: '{bad json}' },
            { sort: '[]' },
            { select: 'null' },
            { skip: '-1' },
            { skip: '1.5' },
            { limit: 'many' },
            { limit: '999999999999999999999' },
        ]) {
            assert.throws(
                () => applyCollectionQuery(queryDouble().Model, parameters, 100),
                (error) => error.status === 400,
            );
        }
    });
});
