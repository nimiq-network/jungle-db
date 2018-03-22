/**
 * This class implements a persistent index for LMDB.
 */
class PersistentIndex extends LMDBBackend {
    /**
     * Creates a new PersistentIndex for a LMDB backend.
     * @param {LMDBBackend} objectStore The underlying LMDB backend.
     * @param {JungleDB} db The underlying JungleDB.
     * @param {string} indexName The index name.
     * @param {string|Array.<string>} [keyPath] The key path of the indexed attribute.
     * If the keyPath is not given, this is a primary index.
     * @param {boolean} [multiEntry] Whether the indexed attribute is considered to be iterable or not.
     * @param {boolean} [unique] Whether there is a unique constraint on the attribute.
     */
    constructor(objectStore, db, indexName, keyPath, multiEntry=false, unique=false) {
        const prefix = `_${objectStore.tableName}-${indexName}`;
        super(db, prefix, undefined, { keyEncoding: GenericValueEncoding });
        this._prefix = prefix;

        /** @type {LMDBBackend} */
        this._objectStore = objectStore;
        this._indexName = indexName;
        this._keyPath = keyPath;
        this._multiEntry = multiEntry;
        this._unique = unique;
    }

    /** The LMDB backend. */
    get backend() {
        return this;
    }

    /**
     * Helper method to return the attribute associated with the key path if it exists.
     * @param {string} key The primary key of the key-value pair.
     * @param {*} obj The value of the key-value pair.
     * @returns {*} The attribute associated with the key path, if it exists, and undefined otherwise.
     * @private
     */
    _indexKey(key, obj) {
        if (this.keyPath) {
            if (obj === undefined) return undefined;
            return ObjectUtils.byKeyPath(obj, this.keyPath);
        }
        return key;
    }

    /**
     * A helper method to insert a primary-secondary key pair into the tree.
     * @param {string} primaryKey The primary key.
     * @param {*} iKeys The indexed key.
     * @param txn
     * @throws if the uniqueness constraint is violated.
     */
    _insert(primaryKey, iKeys, txn) {
        if (!this._multiEntry || !Array.isArray(iKeys)) {
            iKeys = [iKeys];
        }

        for (const secondaryKey of iKeys) {
            let pKeys = super._get(txn, secondaryKey);
            if (this._unique) {
                if (pKeys !== undefined) {
                    throw new Error(`Uniqueness constraint violated for key ${secondaryKey} on path ${this._keyPath}`);
                }
                pKeys = primaryKey;
            } else {
                pKeys = pKeys || [];
                pKeys.push(primaryKey);
            }
            super._put(txn, secondaryKey, pKeys);
        }
    }

    /**
     * A helper method to remove a primary-secondary key pair from the tree.
     * @param {string} primaryKey The primary key.
     * @param {*} iKeys The indexed key.
     * @param txn
     */
    _remove(primaryKey, iKeys, txn) {
        if (!this._multiEntry || !Array.isArray(iKeys)) {
            iKeys = [iKeys];
        }
        // Remove all keys.
        for (const secondaryKey of iKeys) {
            let pKeys = super._get(txn, secondaryKey);
            if (pKeys) {
                if (!this._unique && pKeys.length > 1) {
                    pKeys.splice(pKeys.indexOf(primaryKey), 1);
                    super._put(txn, secondaryKey, pKeys);
                } else {
                    super._remove(txn, secondaryKey);
                }
            }
        }
    }

    /**
     * Inserts a new key-value pair into the index.
     * For replacing an existing pair, the old value has to be passed as well.
     * @param {string} key The primary key of the pair.
     * @param {*} value The value of the pair. The indexed key will be extracted from this.
     * @param {*} [oldValue] The old value associated with the primary key.
     * @param txn
     */
    put(key, value, oldValue, txn) {
        const oldIKey = this._indexKey(key, oldValue);
        const newIKey = this._indexKey(key, value);

        if (oldIKey !== undefined) {
            this._remove(key, oldIKey, txn);
        }
        if (newIKey !== undefined) {
            this._insert(key, newIKey, txn);
        }
    }

    /**
     * Removes a key-value pair from the index.
     * @param {string} key The primary key of the pair.
     * @param {*} oldValue The old value of the pair. The indexed key will be extracted from this.
     * @param txn
     */
    remove(key, oldValue, txn) {
        const iKey = this._indexKey(key, oldValue);
        if (iKey !== undefined) {
            this._remove(key, iKey, txn);
        }
    }

    /**
     * A helper method to retrieve the values corresponding to a set of keys.
     * @param {Array.<string|Array.<string>>} results The set of keys to get the corresponding values for.
     * @returns {Array.<*>} The array of values.
     * @protected
     */
    _retrieveValues(results) {
        const values = [];
        for (const key of this._retrieveKeys(results)) {
            values.push(this._objectStore.getSync(key));
        }
        return values;
    }

    /**
     * A helper method to retrieve the values corresponding to a set of keys.
     * @param {Array.<string|Array.<string>>} results The set of keys to get the corresponding values for.
     * @returns {Array.<string>} A promise of the array of values.
     * @protected
     */
    _retrieveKeys(results) {
        const keys = [];
        for (const result of results) {
            if (Array.isArray(result)) {
                for (const key of result) {
                    keys.push(key);
                }
            } else {
                keys.push(result);
            }
        }
        return keys;
    }

    /**
     * Internally applies a transaction to the store's state.
     * This needs to be done in batch (as a db level transaction), i.e., either the full state is updated
     * or no changes are applied.
     * @param {Transaction} tx The transaction to apply.
     * @param txn
     * @override
     */
    applySync(tx, txn) {
        if (tx._truncated) {
            this._truncate(txn);
        }

        for (const key of tx._removed) {
            const oldValue = tx._originalValues.get(key);
            this.remove(key, oldValue, txn);
        }
        for (const [key, value] of tx._modified) {
            const oldValue = tx._originalValues.get(key);
            this.put(key, value, oldValue, txn);
        }
    }

    /**
     * The name of the index.
     * @type {string}
     */
    get name() {
        return this._indexName;
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
     * Returns a promise of an array of objects whose secondary keys fulfill the given query.
     * If the optional query is not given, it returns all objects in the index.
     * If the query is of type KeyRange, it returns all objects whose secondary keys are within this range.
     * @param {KeyRange} [query] Optional query to check secondary keys against.
     * @returns {Promise.<Array.<*>>} A promise of the array of objects relevant to the query.
     */
    async values(query=null) {
        const results = await LMDBBackend.prototype.values.call(this, query);
        return this._retrieveValues(values);
    }

    /**
     * Returns a promise of a set of primary keys, whose associated objects' secondary keys are in the given range.
     * If the optional query is not given, it returns all primary keys in the index.
     * If the query is of type KeyRange, it returns all primary keys for which the secondary key is within this range.
     * @param {KeyRange} [query] Optional query to check the secondary keys against.
     * @returns {Promise.<Set.<string>>} A promise of the set of primary keys relevant to the query.
     */
    async keys(query=null) {
        const results = await LMDBBackend.prototype.values.call(this, query);
        return Set.from(this._retrieveKeys(results));
    }

    /**
     * Returns a promise of an array of objects whose secondary key is maximal for the given range.
     * If the optional query is not given, it returns the objects whose secondary key is maximal within the index.
     * If the query is of type KeyRange, it returns the objects whose secondary key is maximal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Array.<*>>} A promise of array of objects relevant to the query.
     */
    async maxValues(query=null) {
        const results = await this.maxValue(query);
        return this._retrieveValues([result]);
    }

    /**
     * Returns a promise of a set of primary keys, whose associated secondary keys are maximal for the given range.
     * If the optional query is not given, it returns the set of primary keys, whose associated secondary key is maximal within the index.
     * If the query is of type KeyRange, it returns the set of primary keys, whose associated secondary key is maximal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Set.<*>>} A promise of the key relevant to the query.
     */
    async maxKeys(query=null) {
        return Set.from(await this.maxValue(query));
    }

    /**
     * Returns a promise of an array of objects whose secondary key is minimal for the given range.
     * If the optional query is not given, it returns the objects whose secondary key is minimal within the index.
     * If the query is of type KeyRange, it returns the objects whose secondary key is minimal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Array.<*>>} A promise of array of objects relevant to the query.
     */
    async minValues(query=null) {
        const result = await this.minValue(query);
        return this._retrieveValues([result]);
    }

    /**
     * Returns a promise of a set of primary keys, whose associated secondary keys are minimal for the given range.
     * If the optional query is not given, it returns the set of primary keys, whose associated secondary key is minimal within the index.
     * If the query is of type KeyRange, it returns the set of primary keys, whose associated secondary key is minimal for the given range.
     * @param {KeyRange} [query] Optional query to check keys against.
     * @returns {Promise.<Set.<*>>} A promise of the key relevant to the query.
     */
    async minKeys(query=null) {
        return Set.from(await this.minValue(query));
    }

    /**
     * Returns the count of entries, whose secondary key is in the given range.
     * If the optional query is not given, it returns the count of entries in the index.
     * If the query is of type KeyRange, it returns the count of entries, whose secondary key is within the given range.
     * @param {KeyRange} [query]
     * @returns {Promise.<number>}
     */
    async count(query=null) {
        const results = await LMDBBackend.prototype.values.call(this, query);
        return this._retrieveKeys(results).length;
    }

    /**
     * Initialises the persistent index by validating the version numbers
     * and loading the InMemoryIndex from the database.
     * @param {number} oldVersion
     * @param {number} newVersion
     * @param {boolean} isUpgrade
     * @returns {PersistentIndex} The fully initialised index.
     */
    init(oldVersion, newVersion, isUpgrade) {
        super.init(oldVersion, newVersion, GenericValueEncoding);

        // Initialise the index on first construction.
        if (isUpgrade) {
            const txn = this._env.beginTxn();

            this._objectStore._readStream((value, primaryKey) => {
                this.put(primaryKey, value, undefined, txn);
            });

            txn.commit();
        }

        return this;
    }
}
Class.register(PersistentIndex);
