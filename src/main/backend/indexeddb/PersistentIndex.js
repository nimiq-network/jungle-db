/**
 * This class represents a wrapper around the IndexedDB indices.
 * @implements {IIndex}
 */
class PersistentIndex {
    /**
     * @param {IDBBackend} objectStore
     * @param {string} indexName
     * @param {string|Array.<string>} keyPath
     * @param {boolean} [multiEntry]
     * @param {boolean} [unique]
     */
    constructor(objectStore, indexName, keyPath, multiEntry = false, unique = false) {
        this._objectStore = objectStore;
        this._indexName = indexName;
        this._keyPath = keyPath;
        this._multiEntry = multiEntry;
        this._unique = unique;
    }

    /**
     * Reinitialises the index.
     * @returns {Promise} The promise resolves after emptying the index.
     */
    async truncate() {
        // Will automatically be truncated.
    }

    /**
     * The key path associated with this index.
     * A key path is defined by a key within the object or alternatively a path through the object to a specific subkey.
     * For example, ['a', 'b'] could be used to use 'key' as the key in the following object:
     * { 'a': { 'b': 'key' } }
     * @type {string|Array.<string>}
     */
    get keyPath() {
        return this._keyPath;
    }

    /**
     * This value determines whether the index supports multiple secondary keys per entry.
     * If so, the value at the key path is considered to be an iterable.
     * @type {boolean}
     */
    get multiEntry() {
        return this._multiEntry;
    }

    /**
     * This value determines whether the index is a unique constraint.
     * @type {boolean}
     */
    get unique() {
        return this._unique;
    }

    /**
     * Internal method to access IDB index.
     * @param {IDBDatabase} db The indexed DB.
     * @returns {IDBIndex} The indexedDB's index object.
     * @private
     */
    _index(db) {
        return db.transaction([this._objectStore.tableName], 'readonly')
            .objectStore(this._objectStore.tableName)
            .index(this._indexName);
    }

    /**
     * Returns a promise of an array of objects whose secondary keys fulfill the given query.
     * If the optional query is not given, it returns all objects in the index.
     * If the query is of type KeyRange, it returns all objects whose secondary keys are within this range.
     * @param {KeyRange} [query] Optional query to check secondary keys against.
     * @param {number} [limit] Limits the number of results if given.
     * @returns {Promise.<Array.<*>>} A promise of the array of objects relevant to the query.
     */
    async values(query = null, limit = null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            const results = [];
            const request = this._index(db).openCursor(query);
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    // Limit
                    if (limit !== null && results.length >= limit) {
                        resolve(results);
                        return;
                    }

                    try {
                        results.push(this._objectStore.decode(cursor.value, cursor.primaryKey));
                    } catch (e) {
                        reject(e);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Returns a promise of a set of primary keys, whose associated objects' secondary keys are in the given range.
     * If the optional query is not given, it returns all primary keys in the index.
     * If the query is of type KeyRange, it returns all primary keys for which the secondary key is within this range.
     * @param {KeyRange} [query] Optional query to check the secondary keys against.
     * @param {number} [limit] Limits the number of results if given.
     * @returns {Promise.<Set.<string>>} A promise of the set of primary keys relevant to the query.
     */
    async keys(query = null, limit = null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            const results = new Set();
            const index = this._index(db);
            const openCursorRequest = index.openKeyCursor ? index.openKeyCursor(query) : index.openCursor(query);
            openCursorRequest.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    // Limit
                    if (limit !== null && results.size >= limit) {
                        resolve(results);
                        return;
                    }

                    results.add(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            openCursorRequest.onerror = () => reject(openCursorRequest.error);
        });
    }

    /**
     * Returns a promise of an array of objects whose secondary key is maximal for the given range.
     * If the optional query is not given, it returns the objects whose secondary key is maximal within the index.
     * If the query is of type KeyRange, it returns the objects whose secondary key is maximal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Array.<*>>} A promise of array of objects relevant to the query.
     */
    async maxValues(query=null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            const results = [];
            let maxKey = null;
            const request = this._index(db).openCursor(query, 'prev');
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor && maxKey === null) {
                    maxKey = cursor.key;
                }
                // Only iterate until key changes.
                if (cursor && ComparisonUtils.equals(maxKey, cursor.key)) {
                    try {
                        results.push(this._objectStore.decode(cursor.value, cursor.primaryKey));
                    } catch (e) {
                        reject(e);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Returns a promise of a set of primary keys, whose associated secondary keys are maximal for the given range.
     * If the optional query is not given, it returns the set of primary keys, whose associated secondary key is maximal within the index.
     * If the query is of type KeyRange, it returns the set of primary keys, whose associated secondary key is maximal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Set.<*>>} A promise of the key relevant to the query.
     */
    async maxKeys(query=null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            const results = new Set();
            let maxKey = null;
            const index = this._index(db);
            const request = index.openKeyCursor ? index.openKeyCursor(query, 'prev') : index.openCursor(query, 'prev');
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor && maxKey === null) {
                    maxKey = cursor.key;
                }
                // Only iterate until key changes.
                if (cursor && ComparisonUtils.equals(maxKey, cursor.key)) {
                    results.add(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Returns a promise of an array of objects whose secondary key is minimal for the given range.
     * If the optional query is not given, it returns the objects whose secondary key is minimal within the index.
     * If the query is of type KeyRange, it returns the objects whose secondary key is minimal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Array.<*>>} A promise of array of objects relevant to the query.
     */
    async minValues(query=null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            const results = [];
            let minKey = null;
            const request = this._index(db).openCursor(query, 'next');
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor && minKey === null) {
                    minKey = cursor.key;
                }
                // Only iterate until key changes.
                if (cursor && ComparisonUtils.equals(minKey, cursor.key)) {
                    try {
                        results.push(this._objectStore.decode(cursor.value, cursor.primaryKey));
                    } catch (e) {
                        reject(e);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Returns a promise of a set of primary keys, whose associated secondary keys are minimal for the given range.
     * If the optional query is not given, it returns the set of primary keys, whose associated secondary key is minimal within the index.
     * If the query is of type KeyRange, it returns the set of primary keys, whose associated secondary key is minimal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Set.<*>>} A promise of the key relevant to the query.
     */
    async minKeys(query=null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            const results = new Set();
            let minKey = null;
            const index = this._index(db);
            const request = index.openKeyCursor ? index.openKeyCursor(query, 'next') : index.openCursor(query, 'next');
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor && minKey === null) {
                    minKey = cursor.key;
                }
                // Only iterate until key changes.
                if (cursor && ComparisonUtils.equals(minKey, cursor.key)) {
                    results.add(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Returns the count of entries, whose secondary key is in the given range.
     * If the optional query is not given, it returns the count of entries in the index.
     * If the query is of type KeyRange, it returns the count of entries, whose secondary key is within the given range.
     * @param {KeyRange} [query]
     * @returns {Promise.<number>}
     */
    async count(query=null) {
        query = IDBTools.convertKeyRange(query);
        const db = await this._objectStore.backend;
        return new Promise((resolve, reject) => {
            let request;
            // Edge compatibility
            if (query) {
                request = this._index(db).count(query);
            } else {
                request = this._index(db).count();
            }
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}
Class.register(PersistentIndex);

