/**
 * This interface describes the general functionality of our B+Tree implementation.
 *
 * All operations that are expected to return a key-record pair actually only set the pointer in the BTree object.
 * This behaviour is due to the original BTree implementation we based on and is likely to change in future versions.
 * @interface
 */
class IBTree {
    /**
     * The total number of records.
     * Note that if the record is a list/set of records, these are not counted.
     * @abstract
     * @type {number}
     */
    get length() { return 0; } // eslint-disable-line no-unused-vars

    /**
     * The current key as returned by any operation.
     * It is null if there is no matching record.
     * @abstract
     * @type {*}
     */
    get currentKey() { return null; } // eslint-disable-line no-unused-vars

    /**
     * The current record as returned by any operation.
     * It is null if there is no matching record.
     * @abstract
     * @type {*}
     */
    get currentRecord() { return null; } // eslint-disable-line no-unused-vars

    /**
     * Inserts a new key-record pair into the BTree, if there is no entry for that key.
     * The current record and current key are set to the new entry in case of success
     * or the existing entry if present.
     * @abstract
     * @param {*} key The unique key for the record.
     * @param {*} rec The record associated with the key.
     * @returns {boolean} True if the record was inserted, false if there was already a record with that key.
     */
    insert(key, rec) {} // eslint-disable-line no-unused-vars

    /**
     * Removes a key-record pair from the BTree.
     * In case of successful deletion, the current record and key will be set to the next entry greater or equal.
     * If no record was found, they will be reset to null.
     * @abstract
     * @param {*} key The unique key for the record.
     * @returns {boolean} True if the record was deleted, false if there is no such record.
     */
    remove(key) {} // eslint-disable-line no-unused-vars

    /**
     * Searches the tree for a specific key and advances the current key/record pointers if found.
     * By default only an exact key match is found, but the near parameter also allows to advance to the next entry
     * greater/less or equal than the specified key.
     * @abstract
     * @param {*} key The key to look for.
     * @param {BTree.NEAR_MODE} [near] Optional parameter, specifies to look for a key k' =/≤/≥ key.
     * @returns {boolean} True if such a key was found, false otherwise.
     */
    seek(key, near=BTree.NEAR_MODE.NONE) {} // eslint-disable-line no-unused-vars

    /**
     * Advances the current key/record pointers by a given number of steps.
     * Default is advancing by 1, which means the next record (the new key will thus be the next larger key).
     * -1 means the previous record (the new key will thus be the next smaller key).
     * @abstract
     * @param {number} [cnt] The number of records to advance (may be negative).
     * @returns {boolean} True if there is a record to advance to, false otherwise.
     */
    skip(cnt = 1) {} // eslint-disable-line no-unused-vars

    /**
     * Jumps to the cnt entry starting from the smallest key (i.e., leftmost leaf, first entry) if cnt > 0.
     * If cnt < 0, it jumps to the cnt entry starting from the largest key (i.e., rightmost leaf, last entry).
     * @abstract
     * @param {number} [cnt] The record to jump to (may be negative).
     * @returns {boolean} True if there is a record to jump to, false otherwise.
     */
    goto(cnt) {} // eslint-disable-line no-unused-vars

    /**
     * Returns the index of the current entry (key/record) in a sorted list of all entries.
     * For the B+ Tree, this is done by traversing the leafs from the leftmost leaf, first entry
     * until the respective key is found.
     * @abstract
     * @returns {number} The entry position.
     */
    keynum() {} // eslint-disable-line no-unused-vars

    /**
     * Jumps to the smallest key's entry (i.e., leftmost leaf, first entry).
     * False will only be returned if the tree is completely empty.
     * @abstract
     * @returns {boolean} True if there is such an entry, false otherwise.
     */
    goTop() {} // eslint-disable-line no-unused-vars

    /**
     * Jumps to the largest key's entry (i.e., rightmost leaf, last entry).
     * False will only be returned if the tree is completely empty.
     * @abstract
     * @returns {boolean} True if there is such an entry, false otherwise.
     */
    goBottom() {} // eslint-disable-line no-unused-vars

    /**
     * Rebuilds/balances the whole tree.
     * Inserting and deleting keys into a tree will result
     * in some leaves and nodes having the minimum number of keys allowed.
     * This routine will ensure that each leaf and node has as many keys as possible,
     * resulting in a denser, flatter tree.
     * False is only returned if the tree is completely empty.
     * @abstract
     * @returns {boolean} True if the tree is not completely empty.
     */
    pack() {} // eslint-disable-line no-unused-vars

    /**
     * Advances to the smallest key k', such that either k' > lower (if lowerOpen) or k' ≥ lower (if !lowerOpen).
     * If lower is undefined, jump to the smallest key's entry.
     * @abstract
     * @param {*} lower A lower bound on the key or undefined.
     * @param {boolean} [lowerOpen] Whether lower may be included or not.
     * @returns {boolean} True if there is such an entry, false otherwise.
     */
    goToLowerBound(lower, lowerOpen=false) {} // eslint-disable-line no-unused-vars

    /**
     * Advances to the largest key k', such that either k' < upper (if upperOpen) or k' ≤ upper (if !upperOpen).
     * If upper is undefined, jump to the largest key's entry.
     * @abstract
     * @param {*} upper An upper bound on the key or undefined.
     * @param {boolean} [upperOpen] Whether upper may be included or not.
     * @returns {boolean} True if there is such an entry, false otherwise.
     */
    goToUpperBound(upper, upperOpen=false) {} // eslint-disable-line no-unused-vars
}
