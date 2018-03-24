const lmdb = require('node-lmdb');
const fs = require('fs');

/**
 * @implements {IJungleDB}
 */
class JungleDB {
    /**
     * Initiates a new database connection. All changes to the database structure
     * require an increase in the version number.
     * Whenever new object stores need to be created, old ones deleted,
     * or indices created/deleted, the dbVersion number has to be increased.
     * When the version number increases, the given function onUpgradeNeeded is called
     * after modifying the database structure.
     * @param {string} databaseDir The name of the database.
     * @param {number} dbVersion The current version of the database.
     * @param {function(oldVersion:number, newVersion:number)} [onUpgradeNeeded] A function to be called after upgrades of the structure.
     * @param {{maxDbs:?number, maxDbSize:number}} options
     */
    constructor(databaseDir, dbVersion, onUpgradeNeeded, options = {}) {
        if (dbVersion <= 0) throw new Error('The version provided must not be less or equal to 0');
        this._databaseDir = databaseDir.endsWith('/') ? databaseDir : `${databaseDir}/`;
        this._dbVersion = dbVersion;
        this._onUpgradeNeeded = onUpgradeNeeded;
        this._connected = false;
        this._objectStores = new Map();
        this._objectStoreBackends = [];
        this._objectStoresToDelete = [];

        if (!options.maxDbSize) throw new Error('maxDbSize is a required option');
        this._options = options;
        this._minResize = options.minResize || 1 << 30; // 1 GB default
    }

    /** The underlying LMDB. */
    get backend() {
        return this._db;
    }

    /** @type {boolean} Whether a connection is established. */
    get connected() {
        return this._connected;
    }

    /** @type {number} */
    get minResize() {
        return this._minResize;
    }

    /** @type {number} */
    set minResize(sizeAdd) {
        this._minResize = sizeAdd || 1 << 30; // 1 GB default
    }

    /** @type {boolean} */
    get autoResize() {
        return this._options.autoResize;
    }

    /**
     * @returns {object}
     */
    info() {
        if (!this.connected) {
            throw new Error('Database information can only be retrieved in connected state');
        }
        return this._db.info();
    }

    /**
     * Creates a volatile object store (non-persistent).
     * @param {ICodec} [codec] A codec for the object store.
     * @returns {ObjectStore}
     */
    static createVolatileObjectStore(codec=null) {
        return new ObjectStore(new InMemoryBackend('', codec), null);
    }

    /**
     * Is used to commit multiple transactions atomically.
     * This guarantees that either all transactions are written or none.
     * The method takes a list of transactions (at least two transactions).
     * If the commit was successful, the method returns true, and false otherwise.
     * @param {Transaction|CombinedTransaction} tx1 The first transaction
     * (a CombinedTransaction object is only used internally).
     * @param {Transaction} tx2 The second transaction.
     * @param {...Transaction} txs A list of further transactions to commit together.
     * @returns {Promise.<boolean>} A promise of the success outcome.
     */
    static async commitCombined(tx1, tx2, ...txs) {
        // If tx1 is a CombinedTransaction, flush it to the database.
        if (tx1 instanceof CombinedTransaction) {
            const functions = [];
            /** @type {Array.<Transaction>} */
            const lmdbTransactions = [];

            const infos = await Promise.all(tx1.transactions.map(tx => tx.objectStore._backend.applyCombined(tx)));
            for (const info of infos) {
                if (typeof info === 'function') {
                    functions.push(info);
                } else {
                    lmdbTransactions.push(info);
                }
            }

            if (lmdbTransactions.length > 0) {
                const txn = tx1.backend.backend.beginTxn();

                for (const tx of lmdbTransactions) {
                    tx.objectStore._backend.applySync(tx, txn);
                }

                txn.commit();
            }
            await Promise.all(functions.map(f => f()));
            return true;
        }
        txs.push(tx1);
        txs.push(tx2);
        if (!txs.every(tx => tx instanceof Transaction)) {
            throw new Error('Invalid arguments supplied');
        }
        const ctx = new CombinedTransaction(...txs);
        return ctx.commit();
    }

    /**
     * Connects to the lmdb.
     * @returns {Promise} A promise resolving on successful connection.
     */
    connect() {
        if (this._db) return Promise.resolve(this._db);

        // Ensure existence of directory.
        if (!fs.existsSync(this._databaseDir)){
            fs.mkdirSync(this._databaseDir);
        }

        this._db = new lmdb.Env();
        this._db.open({
            path: this._databaseDir,
            mapSize: this._options.maxDbSize,
            maxDbs: this._options.maxDbs || 3 // default
        });

        // Check if resize is needed.
        if (this.autoResize && this.needsResize()) {
            this.doResize();
        }

        this._mainDb = this._db.openDbi({
            name: null,
            create: true
        });

        return this._initDB();
    }

    /**
     * Closes the database connection.
     * @returns {Promise} The promise resolves after closing the database.
     */
    close() {
        if (this._connected) {
            this._connected = false;
            this._mainDb.close();
            this._db.close();
        }
        return Promise.resolve();
    }

    /**
     * Fully deletes the database.
     * @returns {Promise} The promise resolves after deleting the database.
     */
    async destroy() {
        await this.close();
        JungleDB._deleteFolderRecursive(this._databaseDir);
    }

    /**
     * Returns the ObjectStore object for a given table name.
     * @param {string} tableName The table name to access.
     * @returns {ObjectStore} The ObjectStore object.
     */
    getObjectStore(tableName) {
        return this._objectStores.get(tableName);
    }

    /**
     * Creates a new object store (and allows to access it).
     * This method always has to be called before connecting to the database.
     * If it is not called, the object store will not be accessible afterwards.
     * If a call is newly introduced, but the database version did not change,
     * the table does not exist yet.
     * @param {string} tableName The name of the object store.
     * @param {{codec:?ICodec, persistent:?boolean, upgradeCondition:?boolean|?function(oldVersion:number, newVersion:number):boolean}|ICodec} [options] An options object (for deprecated usage: A codec for the object store).
     * @param {boolean} [persistentArg] If set to false, this object store is not persistent.
     * @returns {IObjectStore}
     */
    createObjectStore(tableName, options=null, persistentArg=true) {
        let { codec = null, persistent = persistentArg, upgradeCondition = null } = (typeof options === 'object' && options !== null) ? options : {};
        if (typeof options === 'object' && options !== null && 'encode' in options && 'decode' in options) codec = options;

        if (this._connected) throw new Error('Cannot create ObjectStore while connected');
        if (this._objectStores.has(tableName)) {
            return this._objectStores.get(tableName);
        }

        const backend = persistent
            ? new LMDBBackend(this, tableName, codec, options)
            : new InMemoryBackend(tableName, codec);
        const objStore = new ObjectStore(backend, this, tableName);
        this._objectStores.set(tableName, objStore);
        this._objectStoreBackends.push({ backend, upgradeCondition });
        return objStore;
    }

    /**
     * Deletes an object store.
     * This method has to be called before connecting to the database.
     * @param {string} tableName
     * @param {{upgradeCondition:?boolean|?function(oldVersion:number, newVersion:number):boolean}} [options]
     */
    deleteObjectStore(tableName, options={}) {
        let { upgradeCondition = null } = options || {};

        if (this._connected) throw new Error('Cannot delete ObjectStore while connected');
        this._objectStoresToDelete.push({ tableName, upgradeCondition });
    }

    /**
     * Checks whether the database needs a resize.
     * This is the case if one of the conditions applies:
     * - free size < thresholdSize (if given)
     * - current database size / maximal mapSize > rand(0.6, 0.9)
     * @param {number} [thresholdSize] An optional threshold of minimum free space.
     * @returns {boolean} Whether a resize is needed.
     */
    needsResize(thresholdSize = 0) {
        const stat = this._db.stat();
        const info = this._db.info();

        const sizeUsed = stat.pageSize * (info.lastPageNumber + 1);

        if (thresholdSize > 0 && info.mapSize - sizeUsed < thresholdSize) {
            Log.i('Database needs resize (thresholdSize)');
            return true;
        }

        // Generate random number in interval [0.6, 0.9)
        const resizePercentage = Math.random() * 0.3 + 0.6;

        if (sizeUsed / info.mapSize > resizePercentage)
        {
            Log.i('Database needs resize (resizePercentage)');
            return true;
        }
        return false;
    }

    /**
     * Tries to resize the maximal database size by max(increaseSize, this.minResize)
     * @param {number} [increaseSize] The size to increase by.
     */
    doResize(increaseSize = 0) {
        const sizeAdd = Math.max(this.minResize, increaseSize);
        const stat = this._db.stat();
        const info = this._db.info();

        let newMapSize = info.mapSize + sizeAdd;
        newMapSize += newMapSize % stat.pageSize;

        this._db.resize(newMapSize);
    }

    toString() {
        return `JungleDB{name=${this._databaseDir}}`;
    }

    /**
     * @param {string} path
     * @private
     */
    static _deleteFolderRecursive(path) {
        if (fs.existsSync(path)) {
            fs.readdirSync(path).forEach((file, index) => {
                const curPath = `${path}/${file}`;
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    JungleDB._deleteFolderRecursive(curPath);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(path);
        }
    }

    /**
     * Internal method that is called for opening the database connection.
     * Also handles the db version upgrade.
     * @returns {Promise.<void>} A promise that resolves after successful completion.
     * @private
     */
    async _initDB() {
        const storedVersion = this._readDBVersion();
        // Upgrade database.
        if (this._dbVersion > storedVersion) {
            // Delete object stores, if requested.
            for (const { tableName, upgradeCondition } of this._objectStoresToDelete) {
                if (upgradeCondition === null || upgradeCondition === true || upgradeCondition(storedVersion, this._dbVersion)) {
                    LMDBBaseBackend.truncate(this._db, tableName);
                }
            }
            this._objectStoresToDelete = [];

            // The order of the above promises does not matter.
            this._writeDBVersion(this._dbVersion);
        }

        // Create new ObjectStores.
        for (const { backend, upgradeCondition } of this._objectStoreBackends) {
            // We do not explicitly create object stores, therefore, we ignore the upgrade condition.
            backend.init(storedVersion, this._dbVersion);
        }

        // Upgrade database (part 2).
        if (this._dbVersion > storedVersion) {
            // Call user defined function if requested.
            if (this._onUpgradeNeeded) {
                await this._onUpgradeNeeded(storedVersion, this._dbVersion);
            }
        }

        this._connected = true;
    }

    /**
     * Returns a promise of the current database version.
     * @returns {number} The database version.
     * @private
     */
    _readDBVersion() {
        const tx = this._db.beginTxn({ readOnly: true });
        const version = tx.getNumber(this._mainDb, '_dbVersion') || 0;
        tx.commit();
        return version;
    }

    /**
     * Writes a new database version to the db.
     * @private
     */
    _writeDBVersion(version) {
        const tx = this._db.beginTxn();
        tx.putNumber(this._mainDb, '_dbVersion', version);
        tx.commit();
    }
}
/** @enum {number} */
JungleDB.Encoding = {
    STRING: 0,
    NUMBER: 1,
    BOOLEAN: 2,
    BINARY: 3
};
/**
 * A LMDB JSON encoding that can handle Uint8Arrays and Sets.
 * @type {{encode: function(val:*):*, decode: function(val:*):*, encoding: JungleDB.Encoding}}
 */
JungleDB.JSON_ENCODING = {
    encode: JSONUtils.stringify,
    decode: JSONUtils.parse,
    encoding: JungleDB.Encoding.STRING
};
/**
 * A LMDB binary encoding.
 * @type {{encode: function(val:*):*, decode: function(val:*):*, encoding: JungleDB.Encoding}}
 */
JungleDB.BINARY_ENCODING = {
    encode: x => x,
    decode: x => x,
    encoding: JungleDB.Encoding.BINARY
};
/**
 * A LMDB string encoding.
 * @type {{encode: function(val:*):*, decode: function(val:*):*, encoding: JungleDB.Encoding}}
 */
JungleDB.STRING_ENCODING = {
    encode: x => {
        if (typeof x !== 'string') {
            throw new Error('Invalid type, expected string');
        }
        return x;
    },
    decode: x => x,
    encoding: JungleDB.Encoding.STRING
};
Class.register(JungleDB);
