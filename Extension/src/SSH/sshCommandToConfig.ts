/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { BasicParser, IParsedOption } from 'posix-getopt';
import { parse } from 'shell-quote';

/**
 * Mapping of flags to functions that add the relevant flag to the map of
 * ssh_config entries. If the function takes a second argument, we'll parse
 * a value for the flag and pass it in.
 */
const flags: {
    [flag: string]: ((entries: { [key: string]: string }, value: string) => void) | null;
} = {
    1: entries => entries.Protocol = '1',
    2: entries => entries.Protocol = '2',
    4: entries => entries.AddressFamily = 'inet',
    6: entries => entries.AddressFamily = 'inet6',
    A: entries => entries.ForwardAgent = 'yes',
    b: (entries, address) => entries.BindAddress = address,
    C: entries => entries.Compression = 'yes',
    c: (entries, cipher) => entries.Cipher = cipher,
    D: (entries, address) => entries.DynamicForward = address,
    // -e (escape code) is used as it's not useful for us and could mess with script execution
    e: null,
    // -F (config file) is irrelevant
    F: null,
    // -f (running in background) would interfere with execution
    f: null,
    g: entries => entries.GatewayPorts = 'yes',
    I: (entries, device) => entries.SmartcardDevice = device,
    i: (entries, identity) => entries.IdentityFile = identity,
    J: (entries, address) => entries.ProxyJump = address,
    K: entries => entries.GSSAPIAuthentication = 'yes',
    k: entries => entries.GSSAPIDelegateCredentials = 'no',
    L: (entries, args) => {
        /**
         * For the cases of:
         * 1. [bind_address:]port:host:hostport
         * 2. [bind_address:]port:remote_socket
         */
        const parsedArgs: RegExpMatchArray | null = args.match(/^((.*):?\d+)?:(.+?)?$/);
        if (parsedArgs) {
            const [, listen, , destination] = parsedArgs;
            if (listen && destination) {
                entries.LocalForward = `${listen} ${destination}`;
                return;
            } else {
                throw new CommandParseError(
                    `LocalForward needs a listener and a destination separate by a colon. ${args} does not match.`
                );
            }
        }

        /**
         * For the cases of:
         * 1. local_socket:host:hostport
         * 2. local_socket:remote_socket
         */

        const delimiter: number = args.indexOf(':');
        if (delimiter === -1) {
            throw new CommandParseError(
                `LocalForward needs a listener and a destination separate by a colon. ${args} does not match.`
            );
        }

        entries.LocalForward = `${args.substring(0, delimiter)} ${args.substring(delimiter + 1)}`;
    },
    l: (entries, user) => entries.User = user,
    M: entries => entries.ControlMaster = 'yes',
    m: (entries, specs) => entries.MACs = specs,
    // -N (don't execute remote command) would interfere with execution
    N: null,
    // -n (redirect stdin) would interfere with execution
    n: null,
    o: (entries, option) => {
        // Option keys never have equals signs in them, always fine to split the first
        const delimiter: number = option.indexOf('=');
        if (delimiter === -1) {
            // `ssh` also fails if missing an argument (doesn't default to "yes", or anything)
            throw new CommandParseError(`Argument missing for option ${option}`);
        }

        entries[option.slice(0, delimiter)] = option.slice(delimiter + 1);
    },
    p: (entries, port) => entries.Port = port,
    // -q (quiet mode) not useful for us
    q: null,
    R: (entries, address) => entries.RemoteForward = address,
    S: (entries, path) => entries.ControlPath = path,
    // -s (remote subsystem invocation), no setting in the config for this
    s: null,
    // -T (disable pseudo tty), no setting in the config for this
    T: null,
    // -t (enable pseudo tty), no setting in the config for this
    t: null,
    // -V (display the version) not relevant for us
    V: null,
    v: entries => entries.LogLevel = 'verbose',
    W: (entries, address) => entries.RemoteForward = address,
    w: (entries, value) => entries.TunnelDevice = value,
    X: entries => entries.ForwardX11 = 'yes',
    x: entries => entries.ForwardX11 = 'no',
    Y: entries => entries.ForwardX11Trusted = 'yes',
    // output logging
    y: null
};

/**
 * Directive passed to getopt(). From OpenSSH
 * @see https://github.com/openssh/openssh-portable/blob/e3b6c966b79c3ea5d51b923c3bbdc41e13b96ea0/ssh.c#L662
 */
const getOptDirective: string = '1246ab:c:e:fgi:kl:m:no:p:qstvxAB:CD:E:F:GI:J:KL:MNO:PQ:R:S:TVw:W:XYy';

/**
 * Error thrown from sshCommandToConfig if the command could not be parsed.
 */
export class CommandParseError extends Error { }

/**
 * Attempts to convert an SSH command to an SSH config entry.
 */
export function sshCommandToConfig(command: string, name?: string): { [key: string]: string } {
    const parts: string[] = parse(command) as string[];

    // ignore 'ssh' if the user entered that as their first word
    if (parts[0] === 'ssh') {
        parts.shift();
    }

    // Once again following what OpenSSH does internally. libc getopt, and our library
    // here, stop when they reach the end of the flags. When that happens we pull
    // out the host if we can, and restart it to try to read any remaining flags.
    const entries: { [key: string]: string } = {};
    for (let offset: number = 0; offset < parts.length; offset++) {
        offset += parseFlags(parts.slice(offset), entries);

        // Only parse the first positional/non-flag argument. The SSH command
        // line allows trailing arguments as commands to execute, but we
        // don't care about those here.
        if (offset < parts.length && !entries.Host) {
            const { hostname, port, username } = parseConnectionString(parts[offset]);
            entries.Host = name || hostname;
            entries.HostName = hostname;

            // In OpenSSH, provided flags take precedence over options in the connection string:
            if (!entries.Port && port) {
                entries.Port = port;
            }
            if (!entries.User && username) {
                entries.User = username;
            }
        }
    }

    if (!entries.Host) {
        throw new CommandParseError('Missing host in SSH connection string');
    }

    // ssh-config requires that the "Host" be the first key in the object
    // in order to nest things correctly. Rewrite the object so that
    // this is the case.
    const { Host, HostName, ...options } = entries;
    return { Host, HostName, ...options };
}

/**
 * Parses flags from the given array of arguments, returning the index of the
 * next non-flag in the input (or the total length of the input if none are found).
 */
function parseFlags(input: string[], entries: { [key: string]: string }): number {
    // prefix with `:` to tell the library not to log anything itself
    const parser: BasicParser = new BasicParser(`:${getOptDirective}`, input, 0);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const next: IParsedOption | undefined = parser.getopt();
        if (!next) {
            break;
        }

        if (next.option === ':') {
            throw new CommandParseError(`Expected flag -${next.optopt} to have an argument but it did not`);
        }

        if (next.option === '?') {
            throw new CommandParseError(`Unknown flag ${next.optopt}`);
        }

        const resolver: ((entries: { [key: string]: string }, value: string) => void) | null = flags[next.option];
        if (!resolver) {
            continue; // known but ignored flag
        }

        resolver(entries, next.optarg);
    }

    return parser.optind();
}

/**
 * Parses the SSH connection address. This behaves like OpenSSH and for the
 * sake of parity (and simplicity) also emulates some of its quirks.
 *
 * The SSH source[1] is relatively simple. First, we try to parse the string as
 * a fully-qualified URI. The URL module helps with that. If that works and
 * the protocol is `ssh://`, roll with that.
 *
 * Failing this, we split the host after the last "@" symbol--hostnames cannot
 * include @ signs, and trying to include one on the OpenSSH command line fails
 * (ssh hello@"example@addr" -> Could not resolve hostname addr). Interestingly,
 * OpenSSH doesn't support the `address:port` syntax, so neither do we,
 * although eliding parity for this scenario may make sense.
 *
 * The SSH URI spec allows for additional connection parameters[2], but these
 * are not mentioned on the ssh(1) man page and don't seem to have use in the
 * wild. In the OpenSSH source, they appear to be ignored[3].
 *
 * The `shell-quote` library, like libc does for OpenSSH, takes care of dealing
 * with quotations for for us.
 *
 *  1. https://github.com/openssh/openssh-portable/blob/e3b6c966b79c3ea5d51b923c3bbdc41e13b96ea0/ssh.c#L999
 *  2. https://tools.ietf.org/html/draft-ietf-secsh-scp-sftp-ssh-uri-04#section-3.3
 *  3. https://github.com/openssh/openssh-portable/blob/master///misc.c#L875-L877
 */
function parseConnectionString(str: string): { hostname: string; port?: string; username?: string } {
    let url: URL | undefined;
    try {
        url = new URL(str);
    } catch {
        // ignored
    }

    // It may seem a little odd, but the handling within OpenSSH is to fall
    // back to the splitting method (rather than erroring) if the wrong protocol
    // is provided. Do the same here for parity's sake.
    // https://github.com/openssh/openssh-portable/blob/e3b6c966b79c3ea5d51b923c3bbdc41e13b96ea0/misc.c#L854-L855
    if (url && url.protocol === 'ssh:') {
        return url;
    }

    // Manual splitting algorithm, augmented with the ability to remove the password:
    // https://github.com/openssh/openssh-portable/blob/e3b6c966b79c3ea5d51b923c3bbdc41e13b96ea0/ssh.c#L1016-L1030
    const hostDelimiter: number = str.lastIndexOf('@');
    if (hostDelimiter === -1) {
        return { hostname: str };
    }

    const hostname: string = str.slice(hostDelimiter + 1);
    let username: string = str.slice(0, hostDelimiter);

    const passwordDelimiter: number = username.indexOf(':');
    if (passwordDelimiter !== -1) {
        username = username.slice(0, passwordDelimiter);
    }

    return { hostname, username };
}
