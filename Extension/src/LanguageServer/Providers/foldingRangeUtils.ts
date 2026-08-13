export interface FoldingRangeLike {
    start: number;
    end: number;
}

export function mergeFoldingRangesWithLimit(primary: FoldingRangeLike[] | undefined, secondary: FoldingRangeLike[], rangeLimit: number | undefined): FoldingRangeLike[] {
    const mergedRanges: FoldingRangeLike[] = (primary ?? []).concat(secondary);

    if (rangeLimit === undefined) {
        return mergedRanges;
    }

    if (rangeLimit <= 0) {
        return [];
    }

    // Keep existing server ranges first, then append access-specifier ranges until the limit.
    return mergedRanges.slice(0, rangeLimit);
}

const accessSpecifierPattern: RegExp = /^\s*(public|protected|private)\s*:\s*$/;
const classDeclarationStartPattern: RegExp = /^\s*(?:template\s*<.*>\s*)?(class|struct|union)\b/;

interface FoldingScanState {
    inBlockComment: boolean;
    rawStringDelimiter?: string;
}

function tryConsumeRawStringStart(line: string, index: number): { consumed: number; rawStringDelimiter: string; } | undefined {
    const remaining = line.slice(index);
    const match = /^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(remaining);
    if (match === null) {
        return undefined;
    }

    return {
        consumed: match[0].length,
        rawStringDelimiter: match[1]
    };
}

function stripLineForFolding(line: string, state: FoldingScanState): { text: string; state: FoldingScanState; } {
    let result = '';
    let index = 0;
    let inString: '"' | '\'' | undefined;

    while (index < line.length) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (state.rawStringDelimiter !== undefined) {
            const rawStringTerminator = `)${state.rawStringDelimiter}"`;
            const rawStringEndIndex = line.indexOf(rawStringTerminator, index);
            if (rawStringEndIndex < 0) {
                index = line.length;
                continue;
            }

            state.rawStringDelimiter = undefined;
            index = rawStringEndIndex + rawStringTerminator.length;
            continue;
        }

        if (state.inBlockComment) {
            if (character === '*' && nextCharacter === '/') {
                state.inBlockComment = false;
                index += 2;
                continue;
            }

            index++;
            continue;
        }

        if (inString !== undefined) {
            if (character === '\\') {
                index += 2;
                continue;
            }

            if (character === inString) {
                inString = undefined;
            }

            index++;
            continue;
        }

        if (character === '/' && nextCharacter === '/') {
            break;
        }

        if (character === '/' && nextCharacter === '*') {
            state.inBlockComment = true;
            index += 2;
            continue;
        }

        const rawStringStart = tryConsumeRawStringStart(line, index);
        if (rawStringStart !== undefined) {
            state.rawStringDelimiter = rawStringStart.rawStringDelimiter;
            index += rawStringStart.consumed;
            continue;
        }

        if (character === '"' || character === '\'') {
            inString = character;
            index++;
            continue;
        }

        result += character;
        index++;
    }

    return { text: result, state };
}

function countCharacter(line: string, character: string): number {
    return (line.match(new RegExp(`\\${character}`, 'g')) ?? []).length;
}

function addFoldingRange(ranges: FoldingRangeLike[], startLine: number, endLine: number): void {
    if (endLine > startLine) {
        ranges.push({ start: startLine, end: endLine });
    }
}

export function collectAccessSpecifierFoldingRanges(text: string): FoldingRangeLike[] {
    const ranges: FoldingRangeLike[] = [];
    const activeSectionsByDepth: Map<number, number> = new Map<number, number>();
    const classBodyDepths: number[] = [];
    const lines: string[] = text.split(/\r?\n/);

    const scanState: FoldingScanState = {
        inBlockComment: false
    };
    let braceDepth = 0;
    let pendingClassDeclaration = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const strippedLine = stripLineForFolding(lines[lineIndex], scanState);

        const lineText = strippedLine.text;
        const currentDepth = braceDepth;
        const currentClassDepth = classBodyDepths[classBodyDepths.length - 1];

        if (currentClassDepth === currentDepth && accessSpecifierPattern.test(lineText)) {
            const activeSectionStart = activeSectionsByDepth.get(currentDepth);
            if (activeSectionStart !== undefined) {
                addFoldingRange(ranges, activeSectionStart, lineIndex - 1);
            }

            activeSectionsByDepth.set(currentDepth, lineIndex);
        }

        if (classDeclarationStartPattern.test(lineText)) {
            pendingClassDeclaration = true;
        }

        const openingBraces = countCharacter(lineText, '{');
        const closingBraces = countCharacter(lineText, '}');

        if (pendingClassDeclaration) {
            if (openingBraces > 0) {
                const classBodyDepth = currentDepth + openingBraces - closingBraces;
                if (classBodyDepth > currentDepth) {
                    classBodyDepths.push(classBodyDepth);
                }
                pendingClassDeclaration = false;
            } else if (lineText.includes(';')) {
                pendingClassDeclaration = false;
            }
        }

        braceDepth = currentDepth + openingBraces - closingBraces;

        while (classBodyDepths.length > 0 && classBodyDepths[classBodyDepths.length - 1] > braceDepth) {
            const endedClassDepth = classBodyDepths.pop();
            if (endedClassDepth === undefined) {
                break;
            }

            const activeSectionStart = activeSectionsByDepth.get(endedClassDepth);
            if (activeSectionStart !== undefined) {
                addFoldingRange(ranges, activeSectionStart, lineIndex - 1);
                activeSectionsByDepth.delete(endedClassDepth);
            }
        }
    }

    const lastLine = lines.length - 1;
    activeSectionsByDepth.forEach((startLine: number) => addFoldingRange(ranges, startLine, lastLine));

    return ranges;
}
