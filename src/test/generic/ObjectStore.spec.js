describe('ObjectStore', () => {
    let allKeys = new Set();
    async function fill(store) {
        for (let i = 0; i < 10; i++) {
            await store.put(`key${i}`, `value${i}`);
            allKeys.add(`key${i}`);
        }
    }

    const backends = [
        TestRunner.nativeRunner('test', 1, jdb => jdb.createObjectStore('testStore'), fill),
        TestRunner.volatileRunner(() => JungleDB.createVolatileObjectStore(), fill)
    ];

    backends.forEach(/** @type {TestRunner} */ runner => {

        it(`can open a transaction and commit it (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();
                
                const tx = objectStore.transaction();
                await tx.remove('key0');
                await tx.put('newKey', 'test');
                expect(await tx.commit()).toBe(true);
                expect(tx.state).toBe(Transaction.STATE.COMMITTED);
                expect(await objectStore.get('key0')).toBe(undefined);
                expect(await objectStore.get('newKey')).toBe('test');
                
                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`can only commit one transaction and ensures read isolation (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();
                
                // Create two transactions on the main state.
                const tx1 = objectStore.transaction();
                // Remove a key in one of those.
                await tx1.remove('key0');
                await tx1.put('test', 'success');
                await tx1.put('key1', 'someval');

                const tx2 = objectStore.transaction();
                // Ensure read isolation.
                expect(await tx1.get('key0')).toBe(undefined);
                expect(await tx2.get('key0')).toBe('value0');
                expect(await tx1.get('test')).toBe('success');
                expect(await tx2.get('test')).toBe(undefined);
                expect(await tx1.get('key1')).toBe('someval');
                expect(await tx2.get('key1')).toBe('value1');

                // Commit one transaction.
                expect(await tx1.commit()).toBe(true);
                expect(tx1.state).toBe(Transaction.STATE.COMMITTED);

                // Still ensure read isolation.
                expect(await tx1.get('key0')).toBe(undefined);
                expect(await tx2.get('key0')).toBe('value0');
                expect(await tx1.get('test')).toBe('success');
                expect(await tx2.get('test')).toBe(undefined);
                expect(await tx1.get('key1')).toBe('someval');
                expect(await tx2.get('key1')).toBe('value1');

                // Create a third transaction, which should be based on tx1.
                const tx3 = objectStore.transaction();
                expect(await tx3.get('key0')).toBe(undefined);
                expect(await tx3.get('test')).toBe('success');
                expect(await tx3.get('key1')).toBe('someval');

                // More changes
                await tx3.remove('key2');
                await tx3.put('test', 'success2');
                await tx3.put('key0', 'someval');

                // Still ensure read isolation.
                expect(await tx1.get('key0')).toBe(undefined);
                expect(await tx3.get('key0')).toBe('someval');
                expect(await tx1.get('test')).toBe('success');
                expect(await tx3.get('test')).toBe('success2');
                expect(await tx1.get('key1')).toBe('someval');
                expect(await tx3.get('key1')).toBe('someval');
                expect(await tx1.get('key2')).toBe('value2');
                expect(await tx3.get('key2')).toBe(undefined);

                // Commit third transaction.
                expect(await tx3.commit()).toBe(true);
                expect(tx3.state).toBe(Transaction.STATE.COMMITTED);

                // Create a fourth transaction, which should be based on tx3.
                const tx4 = objectStore.transaction();
                expect(await tx4.get('key0')).toBe('someval');
                expect(await tx4.get('test')).toBe('success2');
                expect(await tx4.get('key1')).toBe('someval');
                expect(await tx4.get('key2')).toBe(undefined);

                // Abort second transaction and commit empty fourth transaction.
                expect(await tx2.abort()).toBe(true);
                expect(await tx4.commit()).toBe(true);
                expect(tx4.state).toBe(Transaction.STATE.COMMITTED);

                // Now everything should be in the backend.
                expect(await objectStore.get('key0')).toBe('someval');
                expect(await objectStore.get('test')).toBe('success2');
                expect(await objectStore.get('key1')).toBe('someval');
                expect(await objectStore.get('key2')).toBe(undefined);

                // Create a fifth transaction, which should be based on the new state.
                const tx5 = objectStore.transaction();
                expect(await tx5.get('key0')).toBe('someval');
                expect(await tx5.get('test')).toBe('success2');
                expect(await tx5.get('key1')).toBe('someval');
                expect(await tx5.get('key2')).toBe(undefined);
                await tx5.abort();

                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`can correctly handle multi-layered transactions (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();
                
                // Create two transactions on the main state.
                const tx1 = objectStore.transaction();
                const tx2 = objectStore.transaction();
                // Remove a key in one of those.
                await tx1.remove('key0');
                // Ensure read isolation.
                expect(await tx1.get('key0')).toBe(undefined);
                expect(await tx2.get('key0')).toBe('value0');

                // Commit one transaction.
                expect(await tx1.commit()).toBe(true);
                expect(tx1.state).toBe(Transaction.STATE.COMMITTED);

                // Still ensure read isolation.
                expect(await tx1.get('key0')).toBe(undefined);
                expect(await tx2.get('key0')).toBe('value0');

                // Create a third transaction, which should be based on tx1.
                const tx3 = objectStore.transaction();
                expect(await tx3.get('key0')).toBe(undefined);

                // Should not be able to commit tx2.
                expect(await tx2.commit()).toBe(false);
                expect(tx2.state).toBe(Transaction.STATE.CONFLICTED);

                // Abort third transaction.
                expect(await tx3.abort()).toBe(true);

                // Now tx1 should be in the backend.
                expect(await objectStore.get('key0')).toBe(undefined);

                // Create a fourth transaction, which should be based on the new state.
                const tx4 = objectStore.transaction();
                expect(await tx4.get('key0')).toBe(undefined);
                await tx4.abort();

                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`correctly processes keys/values queries (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();
                
                // Ordering on strings might not be as expected!
                expect(await objectStore.keys()).toEqual(allKeys);
                expect(await objectStore.keys(KeyRange.upperBound('key5'))).toEqual(new Set(['key0', 'key1', 'key2', 'key3', 'key4', 'key5']));
                expect(await objectStore.keys(KeyRange.lowerBound('key1', true))).toEqual(allKeys.difference(['key0', 'key1']));
                expect(await objectStore.keys(KeyRange.lowerBound('key5', true))).toEqual(new Set(['key6', 'key7', 'key8', 'key9']));

                expect(await objectStore.values(KeyRange.only('key5'))).toEqual(['value5']);

                expect(await objectStore.minKey()).toEqual('key0');
                expect(await objectStore.maxKey()).toEqual('key9');
                expect(await objectStore.minValue()).toEqual('value0');
                expect(await objectStore.maxValue()).toEqual('value9');

                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`correctly constructs key streams (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();
                
                let i = 0;
                await objectStore.keyStream(key => {
                    expect(key).toBe(`key${i}`);
                    ++i;
                    return true;
                });
                expect(i).toBe(10);
                --i;

                await objectStore.keyStream(key => {
                    expect(key).toBe(`key${i}`);
                    --i;
                    return true;
                }, false);
                expect(i).toBe(-1);

                i = 4;
                await objectStore.keyStream(key => {
                    expect(key).toBe(`key${i}`);
                    --i;
                    return true;
                }, false, KeyRange.bound('key1', 'key4'));
                expect(i).toBe(0);

                i = 4;
                await objectStore.keyStream(key => {
                    expect(key).toBe(`key${i}`);
                    ++i;
                    return i < 5;
                }, true, KeyRange.lowerBound('key3', true));
                expect(i).toBe(5);

                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`correctly constructs value streams (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();
                
                let i = 0;
                await objectStore.valueStream((value, key) => {
                    expect(value).toBe(`value${i}`);
                    expect(key).toBe(`key${i}`);
                    ++i;
                    return true;
                });
                expect(i).toBe(10);
                --i;

                await objectStore.valueStream((value, key) => {
                    expect(value).toBe(`value${i}`);
                    expect(key).toBe(`key${i}`);
                    --i;
                    return true;
                }, false);
                expect(i).toBe(-1);

                i = 4;
                await objectStore.valueStream((value, key) => {
                    expect(value).toBe(`value${i}`);
                    expect(key).toBe(`key${i}`);
                    --i;
                    return true;
                }, false, KeyRange.bound('key1', 'key4'));
                expect(i).toBe(0);

                i = 4;
                await objectStore.valueStream((value, key) => {
                    expect(value).toBe(`value${i}`);
                    expect(key).toBe(`key${i}`);
                    ++i;
                    return i < 5;
                }, true, KeyRange.lowerBound('key3', true));
                expect(i).toBe(5);

                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`correctly processes limited queries (${runner.type})`, (done) => {
            (async function () {
                const objectStore = await runner.init();

                function expectLimited(given, expected, limit) {
                    const size = Array.isArray(given) ? given.length : given.size;
                    expect(size).toBe(limit);
                    expect(new Set(given)).toEqual(new Set(given).intersection(new Set(expected)));
                }

                // Ordering on strings might not be as expected!
                expectLimited(await objectStore.keys(/*query*/ null, 5), allKeys, 5);
                expectLimited(await objectStore.keys(KeyRange.upperBound('key5'), 2), new Set(['key0', 'key1', 'key2', 'key3', 'key4', 'key5']), 2);
                expectLimited(await objectStore.keys(KeyRange.lowerBound('key1', true), 1), allKeys.difference(['key0', 'key1']), 1);
                expectLimited(await objectStore.keys(KeyRange.lowerBound('key5', true), 3), new Set(['key6', 'key7', 'key8', 'key9']), 3);

                expectLimited(await objectStore.values(KeyRange.only('key5'), 0), ['value5'], 0);

                await runner.destroy();
            })().then(done, done.fail);
        });

        it(`returns ordered results (${runner.type})`, (done) => {
            (async function () {
                // Write something into an object store.
                let st = await runner.init();
                await st.truncate();

                await st.put('test1', {'v': 1, 'a': 123});
                await st.put('test3', {'v': 3, 'a': 123});
                await st.put('test2', {'v': 2, 'a': 123});
                await st.put('test0', {'v': 0, 'a': 124});

                let keys = await st.keys();
                let i = 0;
                for (const key of keys) {
                    expect(key).toBe(`test${i}`);
                    i++;
                }

                let values = await st.values();
                i = 0;
                for (const value of values) {
                    expect(value.v).toBe(i);
                    i++;
                }

                keys = await st.keys(KeyRange.lowerBound('test2'));
                i = 2;
                for (const key of keys) {
                    expect(key).toBe(`test${i}`);
                    i++;
                }

                values = await st.values(KeyRange.upperBound('test1'));
                i = 0;
                for (const value of values) {
                    expect(value.v).toBe(i);
                    i++;
                }

                await runner.destroy();
            })().then(done, done.fail);
        });
    });
});
