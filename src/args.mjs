// Tiny argument parser. Its real job is rejecting what it does not understand:
// a silently ignored `--port` typo would serve on the wrong port and look fine.

export class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {{flags?: string[], options?: string[]}} spec
 * @returns {{flags: Set<string>, options: Record<string, string>, positionals: string[], has: (f: string) => boolean}}
 */
export function parseArgs(argv, { flags = [], options = [] } = {}) {
    const seenFlags = new Set();
    const values = {};
    const positionals = [];

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (!argument.startsWith('--')) {
            positionals.push(argument);
            continue;
        }

        // Both `--port 4802` and `--port=4802` are accepted.
        const equals = argument.indexOf('=');
        const name = equals === -1 ? argument : argument.slice(0, equals);

        if (options.includes(name)) {
            const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
            if (value === undefined || value.startsWith('--')) {
                throw new UsageError(`${name} expects a value, for example: ${name} 4801`);
            }
            values[name.replace(/^--/, '')] = value;
            continue;
        }

        if (flags.includes(name)) {
            if (equals !== -1) throw new UsageError(`${name} takes no value.`);
            seenFlags.add(name);
            continue;
        }

        throw new UsageError(`Unknown option: ${argument}`);
    }

    return { flags: seenFlags, options: values, positionals, has: flag => seenFlags.has(flag) };
}
