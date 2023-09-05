/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/ban-types */

// Deep Partial implementation
export type Primitive = string | number | boolean | bigint | symbol | undefined | null | Date | Function | RegExp;
export type DeepPartial<T> =
    T extends Primitive | Function | Date ? T :
        {
            [P in keyof T]?:
            T[P] extends (infer U)[] ? DeepPartial<U>[] :
                T[P] extends readonly (infer V)[] ? readonly DeepPartial<V>[] :
                    T[P] extends Primitive ? T[P] :
                        DeepPartial<T[P]>
        } | T;

/** An Expression supports tempate variable substitution (ie `the workspace is $ {workspaceFolder}, the PATH is $ {env:PATH} `) */
export type Expression = string;

/** A Conditional is an Expression that is used to conditially apply configuation based on a specific condition being met */
export type Conditional = Expression;

/** One or more (as a type or an array of a type) */
export type OneOrMore<T> = T | T[];

/** A regular expression in a string
 *
 * take care that the string is properly escaped (ie, backslashes)
 */
export type RegularExpression = string;

/** Discovery requirements operations */
export type Operation = 'match' | 'folder' | 'file' | 'regex';

/** officially supported standards (c++) */
export type CppStandard = 'c++98' | 'c++03' | 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';

/** officially supported standards (c) */
export type CStandard = 'c89' | 'c99' | 'c11' | 'c17' | 'c23';

/** Package manager names */
export type PkgMgr = 'apt' | 'brew' | 'winget' | 'yum' | 'rpm' | 'dpkg';

/** Language selection */
export type Language = 'c' | 'cpp' | 'c++' | 'cuda';

/** A package definition */
export type Package = Partial<Record<PkgMgr, OneOrMore<string>>>;

/** A query definition - the 'active' requirements to get settings from a binary */
export type Query = Record<Expression, Record<string, OneOrMore<Expression>>>;

/** #define macro definitions */
export type Macros = Record<string, string | number | boolean | null>;

/** the target 'platform' (aka OS) */
export type Platform =
    'windows' | // windows
    'linux' | // linux
    'macos' | // apple osx/darwin
    'ios' | // apple ios
    'none' | // bare metal
    'android' | // android
    'wasm' | // wasm
    'unknown'; // don't know what it is

/** The Target CPU/Processor architecture */
export type Architecture =
    'arm' | // arm aka aarch32
    'arm64' | // 64bit arm, aka aarch64
    'avr' | // AVR (arduino)
    'x64' | // x86_64 aka amd64 aka x64
    'x86' | // x86 (32bit)
    'riscv' | // riscv
    'ia64' | // ia64
    'mips' | // mips
    'ppc' | // ppc
    'sparc' | // sparc
    'wasm' | // wasm
    'unknown'; // don't know what it is

/** The "well-known" compiler. At the moment, some back end parts make assumptions base on this */
export type CompilerVariant = 'msvc' | 'clang' | 'gcc';

/** The (passive) requirements to discover a binary  */
export interface Discover {
    binary: OneOrMore<RegularExpression>;
    locations?: OneOrMore<string>;

    /** 'match' examines the binary file itself to search for strings via regex */
    [key: `match:${string}`]: Record<RegularExpression, any>;
    [key: `match#${string}`]: Record<RegularExpression, any>;
    [key: `matches:${string}`]: Record<RegularExpression, any>;
    [key: `matches#${string}`]: Record<RegularExpression, any>;
    match?: Record<RegularExpression, any>;
    matches?: Record<RegularExpression, any>;

    /** Expressions are evaluated, and if 'truthy' will apply the Installisense block */
    [key: `expressions:${string}`]: Record<Expression, any>;
    [key: `expressions#${string}`]: Record<Expression, any>;
    [key: `expression:${string}`]: Record<Expression, any>;
    [key: `expression#${string}`]: Record<Expression, any>;
    expressions?: Record<Expression, any>;
    expression?: Record<Expression, any>;
}

export interface SizeOf {
    char?: number;
    short?: number;
    int?: number;
    long?: number;
    float?: number;
    double?: number;
    longDouble?: number;
    pointer?: number;

    /** number of digits in long double manitissa (64/53) */
    digitsInLongDoubleMantissa?: number;

    /** alignment of the long double */
    alignmentOfLongDouble?: number;

    /** In C++17 mode, the alignment beyond which new and delete expressions will use the versions of
            allocation and deallocation functions with an alignment parameter  */
    defaultNewAlignment?: number;
}

export interface TypeAliases {
    wcharT?: string;
    sizeT?: string;
    ptrDiffT?: string;
}

export interface Includes {
    quotePaths?: OneOrMore<Expression>; // specified `-iquote` paths - Used for ONLY #include "..."
    paths?: OneOrMore<Expression>; // standard specified include paths (ie, `-I`)
    systemPaths?: OneOrMore<Expression>; // specified `-isystem` paths
    builtInPaths?: OneOrMore<Expression>; // Directories specified that are built into the compiler (usually thru interrogation)
    afterPaths?: OneOrMore<Expression>; // specified `-idirafter` paths
    externalPaths?: OneOrMore<Expression>; // specified `-external:I` paths (MSVC)
    frameworkPaths?: OneOrMore<Expression>; // specified `-F` paths (MacOS)
    environmentPaths?: OneOrMore<Expression>; // paths that are specified via environment variables (ie `INCLUDE`)
}

/** the Intellisense interface represents the things that a given toolset supports/exposes */
export interface IntelliSense {
    /** meta-property: telemetry entries to track */
    [key: `telemetry:${string}`]: Record<string, string | number | boolean>;

    /** meta-property:error/warnings/info encountered */
    [key: `message:${string}`]: OneOrMore<string>;

    /** any unstructured data that is added by definitions */
    [key: `${string}`]: any;

    /** #define macros that are specified so that the backend understands how to handle the code */
    macros?: Macros;

    /** Include folders */
    include?: Includes;

    /** Framework locations */
    frameworkPaths?: OneOrMore<Expression>;

    /** paths to files that are forcibly #included */
    forcedIncludeFiles?: OneOrMore<Expression>;

    /** the C++ standard that this toolset supports */
    cppStandard?: CppStandard | number;

    /** the C Standard that this toolset supports */
    cStandard?: CStandard | number;

    /** refined arguments that are passed to the language parser (edg) */
    parserArguments?: OneOrMore<string>;

    /** Well-known compiler variant (currently, just the three) */
    compiler?: CompilerVariant;

    /** the target platform */
    platform?: Platform;

    /** The target CPU/Processor architecture */
    architecture?: Architecture;

    /** architecture bits? */
    bits?: number;

    /** sizes of the various types */
    sizes?: SizeOf;

    /** type aliases (what is the 'type' for a given type ) */
    types?: TypeAliases;

    /** additional arguments that are being passed to the compiler (unprocessed) */
    compilerArgs?: OneOrMore<string>; // arguments that are assumed to be passed to the compiler on the command line
}

export interface IntelliSenseConfiguration extends IntelliSense {
    /** meta-property: things can be removed via remove:<setting> ...  */
    [key: `remove:${string}`]: OneOrMore<string>;

    /** meta-property: things can be prepended to a collection via prepend:<setting> ...  */
    [key: `prepend:${string}`]: OneOrMore<string>;

    /** the selected language for this configuration */
    lanugage?: Language;

    /** the selected/overridden lanaguage standard version of this configuration */
    standard?: CppStandard | CStandard;

    /** the full path to the compiler */
    compilerPath: string;
}

/** The interface for the toolset.XXX.json file */
export interface DefinitionFile {
    /** The cosmetic name for the toolkit */
    name: string;

    /** The cosmetic version for the toolkit */
    version?: string;

    /** files to automatically load and merge */
    import?: OneOrMore<string>;

    /** Describes the steps to find this toolkit */
    discover: Discover;

    /** Analysis steps to take the gathered data and transform it for the backend */
    analysis?: Analysis;

    /** Explicitly declared settings about this toolset */
    intellisense?: DeepPartial<IntelliSense>;

    /** The package identities if we are interested in bootstrapping it. */
    package?: Package;

    /** Conditional events that allow us to overlay additional configuration when a condition is met */
    conditions?: Record<string, OneOrMore<string> | PartialDefinitionFile>;
}

/** Analysis phase declarations */
export interface Analysis {
    /** Custom steps to trigger (ie, specific built-in actions) */
    [key: `tasks:${string}`]: OneOrMore<string>;
    [key: `tasks#${string}`]: OneOrMore<string>;
    [key: `task:${string}`]: OneOrMore<string>;
    [key: `task#${string}`]: OneOrMore<string>;
    tasks?: Record<string, OneOrMore<string>>;
    task?: Record<string, OneOrMore<string>>;

    /**
     * A map of <engineered regex sequences> to <what to apply when it matches>
     *
     * "engineered regex sequence" is a packed string that is semicolon separated regular expressions
     * each regular expression will have '^'' and '$'' added to assume that a full argument must be matched
     * tagged template literals (${}) are processed before anything else, ( which we can use for built-in macros)
     * after that, the seqence of regular expressions is split
     * when there are more than one, all of the regular expressions should match arguments in order (from the current arg)
     * so "-D;(?<val>.*)" would be valid if a -D parameter was followed by anything.
     *
     * the analysis phase is run, and the compiler args are run thru the list of the regular expressions
     * if a match is found, the data is applied to the toolset block, and the args are consumed/dropped
     * (unless keep:true is in the apply block)
     *
     * Since they are run in order, the first match wins, and the args are consumed (unless 'keep:true' is specified).
     */
    [key: `commandLineArguments:${string}`]: Record<string, any>;
    [key: `commandLineArguments#${string}`]: Record<string, any>;
    [key: `commandLineArgument:${string}`]: Record<string, any>;
    [key: `commandLineArgument#${string}`]: Record<string, any>;
    commandLineArgument?: Record<string, any>;
    commandLineArguments?: Record<string, any>;

    /** Expressions are evaluated, and if 'truthy' will apply the InstallisenseConfiguration block */
    [key: `expressions:${string}`]: Record<string, any>;
    [key: `expressions#${string}`]: Record<string, any>;
    [key: `expression:${string}`]: Record<string, any>;
    [key: `expression#${string}`]: Record<string, any>;
    expressions?: Record<string, any>;
    expression?: Record<string, any>;

    /** Query steps to ask the compiler (by executing it) about its settings */
    [key: `queries:${string}`]: Record<Expression, Record<string, any>>;
    [key: `queries#${string}`]: Record<Expression, Record<string, any>>;
    [key: `query:${string}`]: Record<Expression, Record<string, any>>;
    [key: `query#${string}`]: Record<Expression, Record<string, any>>;
    queries?: Record<Expression, Record<string, any>>;
    query?: Record<Expression, Record<string, any>>;
}

/** A partial definition file */
export type PartialDefinitionFile = DeepPartial<DefinitionFile>;
