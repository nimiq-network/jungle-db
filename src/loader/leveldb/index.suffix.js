// Print stack traces to the console.
Error.prototype.toString = function () {
    return this.stack;
};

// Don't exit on uncaught exceptions.
process.on('uncaughtException', (err) => {
    console.error(`Uncaught exception: ${err.message || err}`);
});
