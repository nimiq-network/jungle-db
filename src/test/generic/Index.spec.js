describe('Index', () => {
    let originalTimeout;

    beforeEach(function() {
        originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    });

    afterEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    });

    it('can access longer keypaths', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            st.createIndex('testIndex', 'val');
            st.createIndex('testIndex2', ['a', 'b']);

            await db.connect();

            await st.put('test', {'val': 123, 'a': {'b': 1}});

            expect((await st.get('test')).val).toBe(123);
            expect(await st.keys(Query.eq('testIndex', 123))).toEqual(new Set(['test']));
            expect(await st.keys(Query.eq('testIndex2', 1))).toEqual(new Set(['test']));
            expect(await st.values(Query.eq('testIndex', 123))).toEqual([{'val': 123, 'a': {'b': 1}}]);
            expect(await st.values(Query.eq('testIndex2', 1))).toEqual([{'val': 123, 'a': {'b': 1}}]);

            expect(await st.index('testIndex').maxKeys()).toEqual(new Set(['test']));
            expect(await st.index('testIndex').maxValues()).toEqual([{'val': 123, 'a': {'b': 1}}]);
            expect(await st.index('testIndex').minKeys()).toEqual(new Set(['test']));
            expect(await st.index('testIndex').minValues()).toEqual([{'val': 123, 'a': {'b': 1}}]);

            await db.destroy();
        })().then(done, done.fail);
    });

    it('can handle values not conforming to index', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            st.createIndex('depth', ['treeInfo', 'depth']);

            await db.connect();

            // Fill object store.
            const expectedJs = new Set();
            for (let i=0; i<10; ++i) {
                for (let j=0; j<5; ++j) {
                    expectedJs.add(j);
                    await st.put(`${i}-${j}`, {'val': i*10+j, 'treeInfo': {'depth': i, 'j': j}});
                    await st.put('head', `${i*10+j}`);
                }
            }
            const tx = st.transaction();
            for (let i=10; i<50; ++i) {
                for (let j=0; j<5; ++j) {
                    expectedJs.add(j);
                    await tx.put(`${i}-${j}`, {'val': i * 10 + j, 'treeInfo': {'depth': i, 'j': j}});
                    await tx.put('head', `${i * 10 + j}`);
                }
            }
            await tx.commit();

            // Retrieve values at specific depth.
            expect(await st.get('head')).toBe(`${49*10+4}`);

            const atDepth5 = await st.values(Query.eq('depth', 5));
            const atDepth15 = await st.values(Query.eq('depth', 15));

            let actualJs = new Set();
            for (const obj of atDepth5) {
                expect(obj['treeInfo']['depth']).toBe(5);
                actualJs.add(obj['treeInfo']['j']);
            }
            expect(actualJs).toEqual(expectedJs);

            actualJs = new Set();
            for (const obj of atDepth15) {
                expect(obj['treeInfo']['depth']).toBe(15);
                actualJs.add(obj['treeInfo']['j']);
            }
            expect(actualJs).toEqual(expectedJs);

            // Retrieve values in depth range for given j.
            const range = await st.values(Query.within('depth', 5, 15));
            const expectedIs = Set.from([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
            for (let j=0; j<5; ++j) {
                const actualIs = new Set();
                for (const obj of range) {
                    if (obj['treeInfo']['j'] === j) {
                        actualIs.add(obj['treeInfo']['depth']);
                    }
                }
                expect(actualIs).toEqual(expectedIs);
            }

            await db.destroy();
        })().then(done, done.fail);
    });

    it('can handle values not conforming to index (using direct index access)', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            st.createIndex('depth', ['treeInfo', 'depth']);

            await db.connect();

            // Fill object store.
            const expectedJs = new Set();
            for (let i=0; i<10; ++i) {
                for (let j=0; j<5; ++j) {
                    expectedJs.add(j);
                    await st.put(`${i}-${j}`, {'val': i*10+j, 'treeInfo': {'depth': i, 'j': j}});
                    await st.put('head', `${i*10+j}`);
                }
            }
            const tx = st.transaction();
            for (let i=10; i<50; ++i) {
                for (let j=0; j<5; ++j) {
                    expectedJs.add(j);
                    await tx.put(`${i}-${j}`, {'val': i * 10 + j, 'treeInfo': {'depth': i, 'j': j}});
                    await tx.put('head', `${i * 10 + j}`);
                }
            }
            await tx.commit();

            // Retrieve values at specific depth.
            expect(await st.get('head')).toBe(`${49*10+4}`);

            const atDepth5 = await st.index('depth').values(KeyRange.only(5));
            const atDepth15 = await st.index('depth').values(KeyRange.only(15));

            let actualJs = new Set();
            for (const obj of atDepth5) {
                expect(obj['treeInfo']['depth']).toBe(5);
                actualJs.add(obj['treeInfo']['j']);
            }
            expect(actualJs).toEqual(expectedJs);

            actualJs = new Set();
            for (const obj of atDepth15) {
                expect(obj['treeInfo']['depth']).toBe(15);
                actualJs.add(obj['treeInfo']['j']);
            }
            expect(actualJs).toEqual(expectedJs);

            // Retrieve values in depth range for given j.
            const range = await st.index('depth').values(KeyRange.bound(5, 15));
            const expectedIs = Set.from([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
            for (let j=0; j<5; ++j) {
                const actualIs = new Set();
                for (const obj of range) {
                    if (obj['treeInfo']['j'] === j) {
                        actualIs.add(obj['treeInfo']['depth']);
                    }
                }
                expect(actualIs).toEqual(expectedIs);
            }

            await db.destroy();
        })().then(done, done.fail);
    });

    it('only fills the index once', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            st.createIndex('depth', ['a', 'b']);
            await db.connect();

            await st.put('test', {'val': 123, 'a': {'b': 1}});
            await st.put('test2', 'other');

            expect(await st.index('depth').count()).toBe(1);

            await db.close();

            // 2nd connection
            db = new JungleDB('indexTest', 1);
            st = db.createObjectStore('testStore');
            st.createIndex('depth', ['a', 'b']);
            await db.connect();

            await st.put('test', {'val': 123, 'a': {'b': 1}});
            await st.put('test2', 'other');

            expect(await st.index('depth').count()).toBe(1);

            await db.destroy();
        })().then(done, done.fail);
    });

    it('can fill the index on implicit upgrade', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            await db.connect();

            await st.put('test', {'val': 123, 'a': {'b': 1}});
            await st.put('test2', 'other');

            await db.close();

            // 2nd connection
            db = new JungleDB('indexTest', 2);
            st = db.createObjectStore('testStore', { upgradeCondition: false });
            st.createIndex('depth', ['a', 'b']);
            await db.connect();

            expect(await st.index('depth').count()).toBe(1);

            await db.destroy();
        })().then(done, done.fail);
    });

    it('can fill the index on explicit upgrade', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            await db.connect();

            await st.put('test', {'val': 123, 'a': {'b': 1}});
            await st.put('test2', 'other');

            await db.close();

            // 2nd connection
            db = new JungleDB('indexTest', 2);
            st = db.createObjectStore('testStore', { upgradeCondition: false });
            st.createIndex('depth', ['a', 'b'], { upgradeCondition: true });
            await db.connect();

            expect(await st.index('depth').count()).toBe(1);

            await db.destroy();
        })().then(done, done.fail);
    });

    it('provides unique indices', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st = db.createObjectStore('testStore');
            st.createIndex('depth', ['a', 'b'], { unique: true });
            await db.connect();

            await st.put('test', {'val': 123, 'a': {'b': 1}});
            let threw = false;
            try {
                await st.put('test2', {'val': 123, 'a': {'b': 1}});
            } catch (e) {
                threw = true;
            }
            expect(threw).toBe(true);

            threw = false;
            let tx = st.transaction();
            try {
                await tx.put('test2', {'val': 123, 'a': {'b': 1}});
            } catch (e) {
                threw = true;
            }
            await tx.abort();
            expect(threw).toBe(true);

            threw = false;
            tx = st.transaction();
            try {
                tx.putSync('test2', {'val': 123, 'a': {'b': 1}});
                await tx.commit();
            } catch (e) {
                threw = true;
            }
            expect(threw).toBe(true);
            expect(tx.state).toBe(Transaction.STATE.ABORTED);

            threw = false;
            tx = st.transaction();
            tx.putSync('test2', {'val': 124, 'a': {'b': 1}});
            try {
                tx.putSync('test3', {'val': 124, 'a': {'b': 1}});
            } catch (e) {
                threw = true;
            }
            await tx.abort();
            expect(threw).toBe(true);

            await db.destroy();
        })().then(done, done.fail);
    });

    it('provides unique indices on combined transactions', (done) => {
        (async function () {
            // Write something into an object store.
            let db = new JungleDB('indexTest', 1);
            let st1 = db.createObjectStore('testStore');
            st1.createIndex('depth', ['a', 'b'], { unique: true });
            const st2 = db.createObjectStore('testStore2');
            await db.connect();

            await st1.put('test', {'val': 123, 'a': {'b': 1}});

            let threw = false;
            const tx1 = st1.transaction();
            const tx2 = st2.transaction();
            try {
                tx1.putSync('test2', {'val': 123, 'a': {'b': 1}});
                tx2.putSync('test2', 'ok');
                await JungleDB.commitCombined(tx1, tx2);
            } catch (e) {
                threw = true;
            }
            expect(threw).toBe(true);
            expect(tx1.state).toBe(Transaction.STATE.ABORTED);
            expect(tx2.state).toBe(Transaction.STATE.ABORTED);

            await db.destroy();
        })().then(done, done.fail);
    });
});
